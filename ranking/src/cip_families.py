"""Two-digit CIP 2020 series, shortened for browsing majors by area."""
from __future__ import annotations

CIP_FAMILIES = {
    "01": "Agriculture", "03": "Natural resources & conservation", "04": "Architecture",
    "05": "Area, ethnic & gender studies", "09": "Communication & journalism",
    "10": "Communications technology", "11": "Computer & information sciences",
    "12": "Culinary & personal services", "13": "Education", "14": "Engineering",
    "15": "Engineering technology", "16": "Languages & linguistics", "19": "Family & consumer sciences",
    "22": "Law & legal studies", "23": "English", "24": "Liberal arts & general studies",
    "25": "Library science", "26": "Biological sciences", "27": "Mathematics & statistics",
    "28": "Military science", "29": "Military technologies", "30": "Interdisciplinary studies",
    "31": "Parks, recreation & fitness", "38": "Philosophy & religious studies", "39": "Theology",
    "40": "Physical sciences", "41": "Science technologies", "42": "Psychology",
    "43": "Security & protective services", "44": "Public administration & social work",
    "45": "Social sciences", "46": "Construction trades", "47": "Mechanic & repair technologies",
    "48": "Precision production", "49": "Transportation", "50": "Visual & performing arts",
    "51": "Health professions", "52": "Business", "54": "History",
}


def family_name(two_digit: str) -> str:
    return CIP_FAMILIES.get(str(two_digit).zfill(2), "Other")
