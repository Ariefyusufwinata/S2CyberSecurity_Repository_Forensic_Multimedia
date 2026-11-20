# Multimedia Forensic Tool Suite

Modul kakas bantu (*tools*) forensik multimedia berbasis JavaScript / Node.js yang dikelompokkan secara terstruktur berdasarkan domain dan tujuan analisis forensik.

---

## Struktur Direktori Berdasarkan Kegunaan

```
tools/
├── interpretation/          # 1. Rule-Based Forensic Interpretation Expert System
│   ├── rules.js             # Definisi rule forensik (Ghost, K-S, ELA, Metadata) & scoring
│   └── index.js             # CLI runner untuk evaluasi rule terhadap berkas citra
├── matching/                # 2. Camera Signature & Database Matching
│   ├── engine.js            # Algoritma pencocokan DQT, EXIF, dan pohon Huffman
│   └── index.js             # CLI verifikasi dan klasifikasi signature kamera
├── tampering/               # 3. Tampering Analysis Lab & Splicing Detection
│   ├── engine.js            # Mesin komputasi JPEG Ghost (Farid 2009) & ELA
│   ├── tampering-lab.js     # Controller UI Web untuk laboratorium simulasi tampering
│   └── index.js             # CLI analisis tampering JPEG Ghost & tabel DQT 8x8
└── dataset/                 # 4. Dataset Acquisition & Signature Curation
    ├── build-signatures.js  # Ekstraksi dan kurasi signature dari direktori images/
    └── watch-images.js      # Watcher otomatis saat ada foto kamera baru ditambahkan
```

---

## 1. Modul Interpretasi Forensik (`tools/interpretation/`)
Mengimplementasikan sistem pakar berbasis aturan (*rule-based expert system*) yang mensintesis temuan multi-metode ke dalam skor probabilitas manipulasi (0–100%) dan rekomendasi objektif:

- **Rule Evaluasi:**
  - `[GHOST-01 / 02]`: Deteksi disparitas QF donor melalui *local minimum* kurva error (Farid 2009).
  - `[KS-01 / 02 / 03]`: Uji divergensi statistik distribusi blok ROI vs Latar (*Kolmogorov-Smirnov test*).
  - `[ELA-01 / 02 / 03]`: Tingkat dispersi error kompresi dan *clipping* residu frekuensi tinggi.
  - `[META-01]`: Jejak re-encoding editor pihak ketiga pada metadata / segmen APP JPEG.
- **Eksekusi CLI:**
  ```bash
  node tools/interpretation/index.js "images/DATASET CIPUT/20261026_100806.jpg"
  ```

---

## 2. Modul Pencocokan Signature (`tools/matching/`)
Melakukan identifikasi dan pencocokan tabel kuantisasi (DQT), EXIF, dan Huffman terhadap katalog signature kamera referensi.

- **Eksekusi CLI:**
  ```bash
  # Verifikasi dan identifikasi model kamera
  node tools/matching/index.js "images/sample.jpg"

  # Tampilkan 5 kandidat model terdekat
  node tools/matching/index.js "images/sample.jpg" --top=5
  ```

---

## 3. Modul Analisis Tampering (`tools/tampering/`)
Menyediakan kalkulasi simulasi penempelan (*splicing*), analisis JPEG Ghost multi-QF (QF 15–90), dan Error Level Analysis (ELA).

- **Eksekusi CLI:**
  ```bash
  # Analisis kompresi ganda & DQT
  node tools/tampering/index.js "images/sample.jpg"

  # Tampilkan matriks kuantisasi 8x8
  node tools/tampering/index.js "images/sample.jpg" --matrix
  ```
- **Web UI:** Terintegrasi di tab **Tampering Lab** pada antarmuka web [index.html](../index.html).

---

## 4. Modul Manajemen Dataset (`tools/dataset/`)
Mengelola akuisisi dataset foto mentah kamera, ekstraksi signature DQT, perputaran orientasi EXIF (*color management*), serta penulisan `signatures.json` dan `dataset.js`.

- **Eksekusi CLI:**
  ```bash
  # Kurasi seluruh foto di images/ menjadi signature database
  node tools/dataset/build-signatures.js

  # Pantau direktori images/ secara otomatis
  node tools/dataset/watch-images.js
  ```

---

## Kompatibilitas Mundur
Untuk menjaga kelancaran alur otomatisasi (misal GitHub Actions CI/CD):
- `tools/build-signatures.js` tetap tersedia sebagai *forwarder* langsung ke `tools/dataset/build-signatures.js`.
- `tools/matching.js` mengarahkan ke `tools/matching/index.js`.
- `tools/tampering.js` mengarahkan ke `tools/tampering/index.js`.
