#!/usr/bin/env node
/**
 * Makes sure Forge's App ID and App Store provisioning profile exist and are current,
 * then writes the profile to the path given as the first argument and prints its UUID.
 *
 * Uses the team's App Store Connect API key from 1Password (no account holder needed).
 *
 *   OP_ACCOUNT=<account> node scripts/asc-profile.mjs <out.mobileprovision> [bundle id]
 *
 * The bundle id defaults to the app; pass co.xanom.forge.widgets for the widget extension.
 *
 * 1Password items (override with env):
 *   FORGE_APPLE_KEY_ITEM   "Xanom Apple Dev Creds"           Key ID, issuer id, AuthKey_<KeyID>.p8
 *   FORGE_IOS_CERT_ITEM    "Apple Distribution Certificate"  Serial Number
 *   FORGE_APPLE_VAULT      "Private"
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

export const BUNDLE_ID = 'co.xanom.forge';
export const APP_NAME = 'College Forge';
export const PROFILE_NAME = 'Forge App Store';
/** App ID capabilities the app's entitlements need; a profile only carries those on when it was made. */
export const CAPABILITIES = ['PUSH_NOTIFICATIONS'];
/** Every bundle the archive signs. The shared keychain group needs no capability. */
export const TARGETS = {
  [BUNDLE_ID]: { name: APP_NAME, profile: PROFILE_NAME, capabilities: CAPABILITIES },
  'co.xanom.forge.widgets': { name: 'College Forge Widgets', profile: 'Forge Widgets App Store', capabilities: [] },
};

const API = 'https://api.appstoreconnect.apple.com';
const VAULT = process.env.FORGE_APPLE_VAULT || 'Private';
const KEY_ITEM = process.env.FORGE_APPLE_KEY_ITEM || 'Xanom Apple Dev Creds';
const CERT_ITEM = process.env.FORGE_IOS_CERT_ITEM || 'Apple Distribution Certificate';

const op = (...args) => execFileSync('op', args, { encoding: 'utf8' }).trim();
const field = (item, label) => op('item', 'get', item, '--vault', VAULT, '--fields', `label=${label}`, '--reveal');

/** App Store Connect JWT (ES256, 10 minutes). */
export function apiToken({ keyId, issuerId, privateKey }, now = Math.floor(Date.now() / 1000)) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

/** Picks the newest active App Store profile that includes the given certificate. */
export function pickProfile(profiles, certificateId, name = PROFILE_NAME) {
  return profiles
    .filter((p) => p.attributes.name === name && p.attributes.profileState === 'ACTIVE')
    .filter((p) => p.certificateIds.includes(certificateId))
    .sort((a, b) => b.attributes.expirationDate.localeCompare(a.attributes.expirationDate))[0];
}

async function main(out, bundleId = BUNDLE_ID) {
  if (!out) throw new Error('usage: node scripts/asc-profile.mjs <out.mobileprovision> [bundle id]');
  const target = TARGETS[bundleId];
  if (!target) throw new Error(`unknown bundle id ${bundleId}`);
  const keyId = field(KEY_ITEM, 'Key ID');
  const key = {
    keyId,
    issuerId: field(KEY_ITEM, 'issuer id'),
    privateKey: op('read', `op://${VAULT}/${KEY_ITEM}/AuthKey_${keyId}.p8`),
  };
  const serial = field(CERT_ITEM, 'Serial Number');

  async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiToken(key)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (json.errors || []).map((e) => `${e.code}: ${e.detail || e.title}`).join('; ');
      throw new Error(`${method} ${path} failed (HTTP ${res.status}) ${detail}`);
    }
    return json;
  }

  let bundle = (await api('GET', `/v1/bundleIds?filter[identifier]=${bundleId}`)).data
    .find((b) => b.attributes.identifier === bundleId);
  if (!bundle) {
    bundle = (await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: bundleId, name: target.name, platform: 'IOS' } },
    })).data;
    console.error(`Registered App ID ${bundleId}`);
  }

  const enabled = new Set((await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data
    .map((c) => c.attributes.capabilityType));
  let capabilitiesChanged = false;
  for (const capabilityType of target.capabilities.filter((c) => !enabled.has(c))) {
    await api('POST', '/v1/bundleIdCapabilities', {
      data: { type: 'bundleIdCapabilities', attributes: { capabilityType }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } } },
    });
    capabilitiesChanged = true;
    console.error(`Turned on ${capabilityType} for ${bundleId}`);
  }

  const certificate = (await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200')).data
    .find((c) => c.attributes.serialNumber === serial);
  if (!certificate) throw new Error(`Apple Distribution certificate ${serial} is not on the team (revoked?)`);

  const listed = await api('GET', `/v1/bundleIds/${bundle.id}/profiles?limit=200`);
  const profiles = await Promise.all(listed.data.map(async (p) => ({
    ...p,
    certificateIds: (await api('GET', `/v1/profiles/${p.id}/relationships/certificates`)).data.map((c) => c.id),
  })));
  let profile = capabilitiesChanged ? undefined : pickProfile(profiles, certificate.id, target.profile);

  if (!profile) {
    // A same-named profile would make Xcode's lookup ambiguous; replace it.
    for (const stale of profiles.filter((p) => p.attributes.name === target.profile)) {
      await api('DELETE', `/v1/profiles/${stale.id}`);
    }
    profile = (await api('POST', '/v1/profiles', {
      data: {
        type: 'profiles',
        attributes: { name: target.profile, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundle.id } },
          certificates: { data: [{ type: 'certificates', id: certificate.id }] },
        },
      },
    })).data;
    console.error(`Created profile "${target.profile}" (expires ${profile.attributes.expirationDate.slice(0, 10)})`);
  }

  const full = (await api('GET', `/v1/profiles/${profile.id}?fields[profiles]=profileContent,uuid,expirationDate`)).data;
  writeFileSync(out, Buffer.from(full.attributes.profileContent, 'base64'));
  console.log(full.attributes.uuid);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2], process.argv[3]).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
