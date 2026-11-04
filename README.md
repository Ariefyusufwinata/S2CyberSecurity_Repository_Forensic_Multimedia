# JPEG Signature Analyzer & Database

A **100% Client-Side** multimedia forensics web application (HTML5, Vanilla JavaScript, CSS3) designed to analyze, classify, and identify camera device models from JPEG images through the extraction of Quantization Tables (DQT $8 \times 8$), compression structures (SOF, DHT, DRI), and EXIF metadata.

The application runs entirely in the user's browser memory and can be hosted statically on **GitHub Pages** without any backend server, external database, third-party API, or web scraping.

---

## 📷 Dataset Credits & Attribution

The default sample dataset (`images/`) utilized in this repository and research is sourced from:

- **Data Owner & Copyright Holder:** **Mandatos PT Francisco Beltrão**
- **Flickr Profile:** [https://www.flickr.com/photos/202288615@N07](https://www.flickr.com/photos/202288615@N07)
- **Flickr Collections / Albums Used:**
  1. `encontro-conselhos` — *Encontro de Conselhos Tutelares (29/10/2026)*
  2. `visita-na-ocupao` — *Visita na Ocupação do São Francisco (23/09/2026)*
- **Usage Purpose:** Academic research, compression analysis, and multimedia forensics education for the **Master of Cyber Security (S2)** program.
- **Copyright Statement:** All original image copyrights remain exclusively with the creator and account owner on Flickr. Sincere appreciation to *Mandatos PT Francisco Beltrão* for making high-quality photographic data publicly accessible for multimedia forensic research.

---

## 🌟 Core Features

### 1. Local Ingestion & Multi-Stage Filtering
- Supports simultaneous sample acquisition via:
  - Multiple file selection
  - Folder upload (`webkitdirectory`)
  - Direct browser `.zip` archive extraction using JSZip
- **Automatic 3-Stage Filtering Pipeline:**
  1. **Binary JPEG Validation:** Verifies the `FF D8 FF` SOI header. Non-JPEG formats (PNG, WEBP, GIF, etc.) are accurately identified and flagged.
  2. **Third-Party Editor Elimination:** Automatically detects and rejects images processed or modified by software editors (e.g., Photoshop, GIMP, Lightroom, Snapseed, Canva).
  3. **Device Metadata Verification:** Ensures camera hardware labels (`Make` & `Model`) are present in EXIF.

### 2. Photo Gallery & Smart Orientation
- Visual catalog of all repository samples with adaptive aspect ratios:
  - **Landscape:** Displays naturally wide (4:3 / 16:9).
  - **Portrait:** Displays naturally vertical and upright (3:4 / 9:16).
- **TIFF/EXIF Forensic Orientation Standard:**
  - Value 1 (Top-Left): *Landscape (Normal)*
  - Value 3 (Bottom-Right): *Landscape (Rotate 180°)*
  - Value 6 (Right-Top): *Portrait (Camera rotated 90° CW)*
  - Value 8 (Left-Bottom): *Portrait (Camera rotated 270° CW)*
- Real-time filtering by search text, device model, dataset folder, and orientation category (*All*, *Portrait*, *Landscape*).

### 3. Forensic Extraction & DQT Heatmaps
- Binary parsing of $8 \times 8$ Quantization Tables (Luminance Tq0 and Chrominance Tq1) using native JavaScript `DataView`.
- Interactive color-intensity heatmap matrix visualization.
- IJG Quality Factor estimation ($\approx Q$).
- Full camera parameter extraction (ISO, Exposure Time, Focal Length, F-Number, Lens Model, etc.).

### 4. Signature Classification Engine
- Groups collected camera compression signatures into 3 forensic categories:
  - **Unique:** Signature exclusive to 1 specific device model.
  - **Shared (Same Manufacture):** Signature shared between 2 models from the same manufacturer.
  - **Shared (Multi-Device):** Signature shared across 3+ distinct devices.
- DQT distance metric clustering to unify adaptive quantization tables (such as Samsung dynamic camera profiles).

### 5. Single Image Forensic Verification
- Matches a target query image against the active signature repository.
- Forensic outcome indicators:
  - **MATCH:** DQT signature is consistent with the claimed EXIF device.
  - **MISMATCH ALERT:** Claimed camera metadata conflicts with compression table characteristics (indicates metadata spoofing or re-compression).
  - **EDITOR WARNING:** Detected traces of photo editing applications.
- One-click export of forensic verification reports to **PDF** format.

### 6. Client-Side Repository Management
- Persistent browser storage powered by **IndexedDB**.
- Full dataset **Export** and **Import** functionality in standard `.json` format (`signatures.json`).
- Pre-bundled with 146 camera samples ready for instant offline analysis upon page load.

---

## 🎨 UI & Design Principles
- **Dark Mode with Navy Blue Accents**.
- **Solid Colors Only:** Zero transparent or translucent elements (`rgba`, `transparent`, `opacity`) for maximum visual contrast and legibility.
- **Mobile-First Responsive Layout:** Bottom touch-bar navigation for mobile screens, flexible tablet grids, and desktop layouts.

---

## 🚀 Running Locally

Serve the repository root using any static web server:

```bash
# Using Python 3:
python3 -m http.server 8000

# Or using Node.js:
npx serve .
```

Open `http://localhost:8000` in your web browser.

---

## 🌐 Deployment to GitHub Pages

1. Commit and push changes to GitHub:
   ```bash
   git add .
   git commit -m "feat: complete JPEG forensic analyzer with English documentation"
   git push origin main
   ```
2. In your GitHub repository, navigate to **Settings** &rarr; **Pages**.
3. Under **Build and deployment** &rarr; **Source**, select **Deploy from a branch**.
4. Choose the **main** branch and **/(root)** folder, then click **Save**.
5. Your application will be live at `https://<username>.github.io/<repo-name>/`.
