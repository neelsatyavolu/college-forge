import UIKit

/// Loads school logos once and keeps them in memory, so scrolling lists don't refetch or get stuck on a
/// load that a scroll cancelled. Failures aren't remembered: the next appearance tries again.
@MainActor
final class LogoCache {
    static let shared = LogoCache()

    private let images = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 4 << 20, diskCapacity: 40 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
        images.countLimit = 400
    }

    func cached(_ url: URL) -> UIImage? {
        images.object(forKey: url as NSURL)
    }

    /// The logo at `url`, or nil when it can't be loaded or decoded. Shares one request per URL.
    func image(for url: URL) async -> UIImage? {
        if let hit = cached(url) { return hit }
        let task = inFlight[url] ?? Task { [session] in
            guard let (data, response) = try? await session.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return await UIImage(data: data)?.byPreparingForDisplay()
        }
        inFlight[url] = task
        // Awaited outside the task so a cancelled caller doesn't cancel the shared load.
        let image = await task.value
        inFlight[url] = nil
        if let image { images.setObject(image, forKey: url as NSURL) }
        return image
    }
}
