"""Two bundled clinical demo cases (fictional data, realistic format).

`raw_text` simulates what OCR returns for an uploaded report, so presets
and uploads flow through the exact same analysis pipeline.
"""

PRESETS = {
    "case-a": {
        "id": "case-a",
        "title": "Case A — Diabetes + Thyroid",
        "description": "52-year-old male. High HbA1c & TSH. Thyronorm + Glycomet GP 1 + Shelcal.",
        "raw_text": """LABORATORY REPORT — Sunrise Diagnostics Centre
Patient: Ramesh Kulkarni, 52 yrs, Male
Referred by: Dr. S. Iyer, MD (General Medicine)

HbA1c: 8.2 %  (HIGH)  [Reference: 4.0 - 5.6 %]
Fasting Blood Sugar: 168 mg/dL  (HIGH)  [70 - 100]
TSH: 7.8 mIU/L  (HIGH)  [0.4 - 4.0]
Free T4: 0.9 ng/dL  (NORMAL)  [0.8 - 1.8]
Total Cholesterol: 210 mg/dL  (BORDERLINE)  [<200]

PRESCRIPTION — Dr. S. Iyer
1. Tab Thyronorm 50 mcg — OD, early morning, empty stomach.
   Wait at least 45 minutes before tea / food / milk / calcium.
2. Tab Glycomet GP 1 (Glimepiride 1 mg + Metformin 500 mg) — BD, after lunch and after dinner.
3. Tab Shelcal 500 (Calcium + Vitamin D3) — OD, after lunch. Keep a 4-hour gap from Thyronorm.
4. Repeat TSH and HbA1c after 8 weeks. Report immediately if sweating, shakiness or palpitations occur.""",
        "sample_doubts": [
            "Aaj mera Somvar ka vrat hai, sirf phal khaya hai — raat wali sugar ki goli loon kya?",
            "Subah thyroid ki goli bhool gaya aur chai pee li — abhi le sakta hoon kya?",
            "Sugar control ho gaya hai toh kya main Glycomet band kar sakta hoon?",
        ],
    },
    "case-b": {
        "id": "case-b",
        "title": "Case B — Post-Fever + Antibiotic",
        "description": "Viral fever resolving. Elevated WBC/CRP. Azithral 500 + Pantocid DSR + Dolo 650 SOS.",
        "raw_text": """LABORATORY REPORT — City Care Pathology Labs
Patient: Meena Nair, 34 yrs, Female
Referred by: Dr. A. Fernandes, MBBS

WBC Count: 12,800 /uL  (HIGH)  [4,000 - 11,000]
CRP: 24 mg/L  (HIGH)  [<5]
Platelets: 2.1 lakh/uL  (NORMAL)  [1.5 - 4.1]
Dengue NS1 Antigen: NEGATIVE
Peripheral smear for Malaria: NEGATIVE

PRESCRIPTION — Dr. A. Fernandes
1. Tab Azithral 500 (Azithromycin) — OD, after breakfast, for 5 days. COMPLETE the full course.
2. Tab Pantocid DSR — BD, 30 minutes before breakfast and before dinner.
3. Tab Dolo 650 (Paracetamol) — SOS only, if fever above 100 F, maximum 3 tablets a day with 6-hour gap.
4. Drink plenty of ORS and fluids. Review after 3 days.""",
        "sample_doubts": [
            "Bukhar utar gaya hai — 5 din ka antibiotic course 2 din mein band kar doon?",
            "Antibiotic curd rice ke saath le sakta hoon ya acidity hogi?",
            "Bukhar dobara chadhe toh Dolo 650 kitni baar de sakte hain?",
        ],
    },
}
