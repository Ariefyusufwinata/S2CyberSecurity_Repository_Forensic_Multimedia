# JPEG Signature Analyzer & Database

Aplikasi web forensik multimedia berbasis **Client-Side Only** (HTML5, Vanilla JavaScript, CSS3) untuk menganalisis dan mengidentifikasi asal model perangkat kamera dari gambar JPEG melalui ekstraksi tabel kuantisasi (DQT $8 \times 8$), struktur kompresi (SOF, DHT, DRI), dan metadata EXIF.

Aplikasi ini dapat di-hosting secara statis di **GitHub Pages** tanpa memerlukan backend server, database eksternal, API pihak ketiga, maupun web scraping.

---

## 📷 Atribusi & Sumber Data (Dataset Credits)

Seluruh sampel dataset gambar JPEG bawaan (`images/`) yang digunakan dalam repositori dan pengujian aplikasi ini bersumber dari:

- **Pemilik Akun & Hak Cipta:** **Mandatos PT Francisco Beltrão**
- **Profil Flickr:** [https://www.flickr.com/photos/202288615@N07](https://www.flickr.com/photos/202288615@N07)
- **Koleksi / Album Flickr yang Digunakan:**
  1. `encontro-conselhos` — *Encontro de Conselhos Tutelares (29/10/2026)*
  2. `visita-na-ocupao` — *Visita na Ocupação do São Francisco (23/09/2026)*
- **Tujuan Penggunaan:** Penelitian, pengujian forensik multimedia, dan keperluan edukasi/akademik pada program **S2 Cyber Security**.
- **Pernyataan:** Hak cipta karya foto sepenuhnya tetap menjadi milik pencipta dan pemilik akun Flickr terkait. Terima kasih sebesar-besarnya kepada *Mandatos PT Francisco Beltrão* atas ketersediaan data foto publik berkualitas tinggi yang memungkinkan penelitian kompresi dan forensik kamera ini dilakukan.

---

## 🌟 Fitur Utama

### 1. Akuisisi & Penyaringan Lokal (Ingestion & Filtering)
- Menerima input gambar JPEG sekaligus melalui:
  - Multi-file upload
  - Folder upload (`webkitdirectory`)
  - Ekstraksi arsip `.zip` langsung di browser menggunakan JSZip
- **3 Tahap Penyaringan Otomatis:**
  1. Validasi biner signature JPEG (`FF D8 FF`). Format non-JPEG (PNG, WEBP, GIF, dll.) teridentifikasi dengan jelas.
  2. Eliminasi gambar hasil editan software pihak ketiga (Photoshop, GIMP, Lightroom, Snapseed, Canva, dll.).
  3. Validasi keberadaan metadata perangkat (`Make` & `Model`) pada EXIF.

### 2. Galeri Foto & Orientasi Cerdas
- Katalog visual seluruh foto dalam repositori dengan aspect-ratio adaptif:
  - Foto **Landscape** tampil melebar alami (4:3 / 16:9).
  - Foto **Portrait** tampil menjulang tegak alami (3:4 / 9:16).
- **Penanganan Orientasi EXIF / TIFF Sesuai Standar Forensik:**
  - Nilai 1 (Top-Left): *Landscape (Normal)*
  - Nilai 3 (Bottom-Right): *Landscape (Rotate 180°)*
  - Nilai 6 (Right-Top): *Portrait (Kamera diputar ke kanan / Rotate 90° CW)*
  - Nilai 8 (Left-Bottom): *Portrait (Kamera diputar ke kiri / Rotate 270° CW)*
- Filter realtime berdasarkan teks pencarian, perangkat kamera, folder dataset, dan kategori orientasi (Portrait / Landscape).

### 3. Ekstraksi Forensik & Visualisasi DQT
- Ekstraksi tabel kuantisasi DQT $8 \times 8$ (Luminance Tq0 dan Chrominance Tq1) menggunakan `DataView` biner.
- Visualisasi heatmap matriks kuantisasi interaktif.
- Estimasi faktor kualitas IJG ($\approx Q$).
- Ekstraksi parameter EXIF lengkap (ISO, Exposure, Focal Length, F-Number, Lens Model, dll.).

### 4. Klasifikasi Signature
- Pengelompokan signature kompresi ke dalam 3 kategori forensik:
  - **Unique:** Signature eksklusif milik 1 model kamera spesifik.
  - **Shared (Same Manufacture):** Signature yang dipakai bersama oleh 2 model dari pabrikan yang sama.
  - **Shared (Multi-Device):** Signature yang dipakai bersama oleh 3+ perangkat berbeda.
- Algoritma jarak selisih kuantisasi (DQT distance metric) untuk mengelompokkan varian tabel dinamis (misal pada sensor Samsung).

### 5. Verifikasi Gambar Tunggal (Forensic Matching)
- Menguji 1 berkas gambar target terhadap repositori aktif.
- Deteksi status kecocokan:
  - **COCOK:** Konsisten dengan klaim EXIF.
  - **MISMATCH:** Klaim EXIF berbeda dengan signature kompresi aslinya (indikasi manipulasi metadata atau kamera palsu).
  - **PERINGATAN EDITOR:** Terdeteksi jejak aplikasi penyuntingan.
- Ekspor hasil analisis forensik ke format **PDF resmi**.

### 6. Manajemen Repositori Mandiri (Offline & Persistent)
- Penyimpanan lokal di browser pengguna via **IndexedDB**.
- Ekspor dan Impor dataset signature dalam format `.json` (`signatures.json`).
- Dataset bawaan 146 sampel foto siap pakai langsung saat web dibuka.

---

## 🎨 Desain & UI
- **Dark Mode dengan Aksen Navy Blue** solid.
- **Tanpa Transparansi:** Bebas dari elemen tembus pandang (`rgba`, `transparent`, `opacity`) untuk keterbacaan kontras tinggi.
- **Responsif Mobile-First:** Navigasi bawah ramah sentuhan untuk smartphone, layout adaptif tablet, dan desktop.

---

## 🚀 Cara Menjalankan Secara Lokal

Cukup jalankan web server statis di root repositori:

```bash
# Menggunakan Python 3:
python3 -m http.server 8000

# Atau menggunakan Node.js / npx serve:
npx serve .
```

Buka browser di `http://localhost:8000`.

---

## 🌐 Deploy ke GitHub Pages

1. Push seluruh file ke repositori GitHub:
   ```bash
   git add .
   git commit -m "feat: complete JPEG signature analyzer with full credits and forensic engine"
   git push origin main
   ```
2. Buka repository di GitHub: **Settings** &rarr; **Pages**.
3. Pada **Source**, pilih **Deploy from a branch**, lalu pilih branch **main** dan folder **/(root)**.
4. Klik **Save**. Web akan aktif di `https://<username>.github.io/<repo-name>/`.

