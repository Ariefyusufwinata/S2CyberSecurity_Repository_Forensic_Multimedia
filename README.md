# JPEG Signature Analyzer & Database

A **100% Client-Side** multimedia forensics web application (HTML5, Vanilla JavaScript, CSS3) designed to analyze, classify, and identify camera device models from JPEG images through the extraction of Quantization Tables (DQT $8 \times 8$), compression structures (SOF, DHT, DRI), and EXIF metadata.

The application runs entirely in the user's browser memory and can be hosted statically on **GitHub Pages** without any backend server, external database, third-party API, or web scraping.

---

## 📷 Dataset Credits & Attribution

The default sample dataset (`images/`) utilized in this repository and research is sourced from:

- **Data Owner & Copyright Holder:** **Mandatos PT Francisco Beltrão**
- **Flickr Profile:** [https://www.flickr.com/photos/202288615@N07](https://www.flickr.com/photos/202288615@N07)
- **Flickr Collections / Albums Used:**
  1. `1-conferncia-municipal-do` — *1ª Conferência Municipal do Esporte (07/10/2026)*
  2. `encontro-conselhos` — *Encontro de Conselhos Tutelares (29/10/2026)*
  3. `manifestao-na-copel-francisco` — *Manifestação na Copel Francisco Beltrão (06/03/2025)*
  4. `visita-na-ocupao` — *Visita na Ocupação do São Francisco (23/09/2026)*
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
- Pre-bundled with 198 camera samples ready for instant offline analysis upon page load.

---

## 🧬 Full Signature Vector (576 features)

The reference method is *Digital Image Authentication from JPEG Headers* (Kee, Johnson & Farid, IEEE TIFS 2011). A camera signature is not only the quantization table; it is the following 576-value vector, extracted in `huffman.js` (`parseJpeg`, `huffSets`, `exifStruct`, `thumbSigOf`, `sigParts`):

| Component | Values | How it is obtained |
|---|---|---|
| Quantization tables Tq0–Tq2 | 3 × 64 = **192** | DQT segments, un-zig-zagged to natural order; missing tables are zero |
| Huffman code lengths | 6 × 15 = **90** | DHT `BITS[1..15]` of Y-DC, Y-AC, Cb-DC, Cb-AC, Cr-DC, Cr-AC |
| Image dimensions | **2** | `(min(w,h), max(w,h))`, so portrait and landscape give the same values |
| Embedded thumbnail | 2 + 192 + 90 = **284** | IFD1 tags `0x0201`/`0x0202` locate the thumbnail JPEG, parsed with the same code (dimensions, DQT, Huffman) |
| EXIF structure | **8** | Entry counts of IFD0, Exif, Interoperability, IFD1, GPS; number of extra IFDs; entries in extra IFDs; parser errors |
| **Total** | **576** | The full-signature ID (`fullKey`) is a 64-bit hash of this vector |

### How the Huffman features are computed

A DHT segment holds, for each table, a `Tc/Th` byte (class 0 = DC, 1 = AC, plus table id), `BITS[1..16]` and `HUFFVAL`. `BITS[L]` is the number of Huffman codes whose length is `L` bits; `HUFFVAL` lists the symbols in code order.

1. The parser reads every DHT and stores `BITS[1..16]` per table.
2. The SOS segment tells which DC table (`Td`) and AC table (`Ta`) each component uses, so the six tables are taken **per component** (Y, Cb, Cr), not in file order.
3. Feature `f[t][L] = BITS_t[L]` for `L = 1..15`, giving 6 × 15 = 90 values.
4. Integrity check using canonical code assignment (JPEG Annex C): start with `code = 0`; for each length `L` the first code is `code`, then `code = (code + BITS[L]) << 1`. The table is valid only if `code` never exceeds `2^L` (Kraft inequality). The first code of each length is shown in the PDF report.

Worked example (Y-DC table of an iPhone sample): `BITS = 0 1 5 1 1 1 1 1 1 0 0 0 0 0 0` means no 1-bit code, one 2-bit code (`00`), five 3-bit codes (`010`–`110`), then one code each for lengths 4–9; 12 symbols in total.

### Equivalence class analysis

A class is the set of devices (Make + Model) that share one signature; its size is `n`. The Classification tab and the catalog PDF report, for three feature sets (DQT only, DQT + Huffman, full 576): number of classes, distribution `n = 1, 2, 3, 4, ≥ 5`, median and maximum `n`, and the number of devices identified uniquely. On the bundled dataset (198 samples across 6 devices):

| Feature set | Classes | n=1 | n=2 | n=3 | Median n | Max n | Devices uniquely identified |
|---|---|---|---|---|---|---|---|
| DQT only (192) | 37 | 35 | 1 | 1 | 1 | 3 | 3 / 6 |
| DQT + Huffman (282) | 41 | 39 | 1 | 1 | 1 | 3 | 3 / 6 |
| Full signature (576) | 56 | 55 | 1 | 0 | 1 | 2 | 4 / 6 |

Adding Huffman tables expands the signature classes from 37 to 41, while adding resolution, thumbnail, and EXIF directory structure expands them to 56 classes and reduces the largest shared Apple iPhone equivalence class from `n = 3` to `n = 2`.

### Dataset filtering (robustness)

Each file passes these checks in order; the first failing check gives the rejection reason shown in the Ingestion table.

| # | Check | What it catches |
|---|---|---|
| 1 | JPEG header `FF D8 FF` and at least one DQT table | Non-JPEG files |
| 2 | **Software tag / XMP `CreatorTool`** matches a known editor | Photoshop, GIMP, Lightroom, Snapseed, Canva, … |
| 3 | **Editing traces without a Software tag** | APP13 `Photoshop 3.0` (8BIM) or APP14 `Adobe` marker; XMP edit history (`xmpMM:History`, `stEvt:action`); quantization tables **exactly equal to the IJG standard tables** (Q1–100) |
| 4 | **Flickr resize derivatives**: long side 75, 100, 150, 240, 320, 500, 640, 800, 1024, 1600 or 2048 px | Re-compressed copies with Flickr's own tables |
| 5 | EXIF `Make` and `Model` present | Ground truth for the device label |
| 6 | **Signature outlier** (after analysis, against the catalog): if the device already has at least 3 samples, the new DQT must be within a mean step difference of 2.0 of one of them | Re-encoded files or a wrong Make/Model. Samples of one camera cluster tightly (Samsung variants differ by ≤ 0.02), so a large distance is suspicious. New devices are not screened |

None of the 146 camera files in the bundled dataset trigger checks 3 or 4. Check 3 was also tested with synthetic files carrying a Photoshop APP13 block, an Adobe APP14 marker, XMP history and an XMP `CreatorTool`; all were rejected while the unmodified original was accepted.

Verification also reports the same editing traces, plus a **native resolution check**: the image's `(min, max)` size is compared with sizes seen in the catalog for the claimed device.

### Known limitations

- Adobe Photoshop reference tables (versions 3–CS5, all quality levels) are **not bundled**; only the IJG baseline is. A Photoshop file that carries no APP13/XMP traces and no Software tag is therefore not caught by check 3. Add reference tables to `SOFTWARE_BASELINES` in `huffman.js` to extend detection.
- Double JPEG compression (periodic artifacts in the DCT histogram) is not analysed.
- The traces are heuristics: a clean re-save by an unknown encoder can still pass, so they reduce but do not eliminate edited files.
- The paper keeps only (Make, Model, Signature) configurations with at least 25 images. This is **reported, not enforced**, because the bundled dataset (146 samples) would otherwise be emptied.
- Only the first scan's Huffman tables are read, so progressive JPEGs that redefine tables between scans are summarised by the first scan.
- Samples without an EXIF thumbnail (22 in the bundled data) get zeros for the 284 thumbnail features, as in the paper.

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

### Automatic Sync When Adding New Folders to `images/`
- **Browser Auto-Discovery (Local Server):** When served via `python3 -m http.server` or `npx serve`, `autoDiscoverImagesFolder()` in `app.js` automatically scans `images/` on page load and ingests any newly added `.jpg` files.
- **Background File Watcher:** Run `node tools/watch-images.js` to watch `images/` and automatically rebuild `signatures.json` and `dataset.js` whenever files/folders are added or modified.
- **Git Pre-Commit Hook:** `.git/hooks/pre-commit` automatically runs `node tools/build-signatures.js` whenever changes under `images/` are staged for commit.

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

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for full details.
Copyright (C) 2026 **Arief Yusuf Winata**.
