# Flycam GIS Viewer

A 3D web GIS platform for visualizing aerial drone (flycam) survey imagery on an interactive globe, built on top of [CesiumJS](https://cesium.com/platform/cesiumjs/). The project replaces a slow, error-prone manual workflow (hand-typed coordinates, static image folders) with an automated pipeline that converts raw GeoTIFF survey data straight into a database-backed map service.

## Highlights

- **Automated GeoTIFF → Tile → Database pipeline.** A single script (`process_all_tifs.js`) takes raw aerial `.tif` files, reprojects/cuts them into Web Mercator XYZ tiles with GDAL, verifies the tile count, loads them into PostgreSQL, and removes the source files — turning a multi-step manual process into one command.
- **Database-backed imagery serving.** Map tiles are stored as binary data in PostgreSQL and streamed through an Express API (`/tiles/:project/:z/:x/:y.png`), so the app no longer depends on imagery files living on disk.
- **Zero-config project list.** New surveys appear automatically in the UI as soon as they're processed — the frontend fetches `/api/projects` and builds the project list, layer toggles, and map rectangles dynamically. No code changes needed to onboard a new dataset.
- **Coordinate-system aware.** Correctly handles the Vietnamese national geodetic system (VN‑2000 / TM‑3 105°45', EPSG:9210), including the datum shift to WGS84 — avoiding the silent positioning errors common in naive reprojection.
- **Production-scale data reduction.** Processed 100+ survey datasets (tens of GB of raw aerial imagery) down to a compact, queryable PostgreSQL dataset, cutting on-disk footprint by roughly 75% while keeping full visual fidelity at zoom levels 15–21.
- **Built-in GIS tooling.** Distance & area measurement, elevation/DEM point overlays, satellite/street basemap switching, and camera fly-to navigation per project.

## Tech Stack

| Layer | Technology |
|---|---|
| 3D Globe Rendering | CesiumJS |
| Backend / API | Node.js, Express |
| Database | PostgreSQL (binary tile storage) |
| Geospatial Processing | GDAL (`gdal raster tile`), proj4 |
| Frontend | Vanilla JS, dynamic DOM rendering |

## How It Works

```
Raw GeoTIFF (.tif)
      │  gdal raster tile  (reproject + cut into XYZ tiles)
      ▼
Tile folder (temporary)
      │  process_all_tifs.js  (verify + load)
      ▼
PostgreSQL  ──  tiles table (binary PNG data)
            ──  projects table (bbox, zoom range, title)
      │
      ▼
Express API  /api/projects, /tiles/:project/:z/:x/:y.png
      │
      ▼
CesiumJS frontend (dynamic project list + map layers)
```

## Getting Started

### Prerequisites

- Node.js >= 22
- PostgreSQL (tested on v17)
- GDAL with the `gdal raster tile` command (e.g. via [OSGeo4W](https://www.osgeo.org/projects/osgeo4w/))

### Setup

```bash
git clone https://github.com/huydevhehe/43G-flycam-gis-viewer.git
cd 43G-flycam-gis-viewer
npm install
```

Create a `.env` file (see `.env.example`) with your local database credentials:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=cesium_gis
```

Create the database and tables:

```sql
CREATE DATABASE cesium_gis;

CREATE TABLE tiles (
  project_key TEXT NOT NULL,
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  data BYTEA NOT NULL,
  PRIMARY KEY (project_key, z, x, y)
);

CREATE TABLE projects (
  project_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  min_zoom INTEGER NOT NULL,
  max_zoom INTEGER NOT NULL,
  west DOUBLE PRECISION NOT NULL,
  south DOUBLE PRECISION NOT NULL,
  east DOUBLE PRECISION NOT NULL,
  north DOUBLE PRECISION NOT NULL
);
```

### Importing aerial survey data

Drop one or more `.tif` files into the project root, then run:

```bash
node process_all_tifs.js
```

Every new `.tif` file is cut into tiles, loaded into PostgreSQL, and removed automatically. Already-processed projects are skipped.

### Running the app

```bash
npm run start -- --port 3003 --public
```

Open `http://localhost:3003/Apps/HelloWorld.html` — every processed survey shows up automatically in the layer panel.

## Project Structure

```
Apps/js/app.js              # Frontend bootstrap: fetches /api/projects, builds UI
Apps/js/MapManager.js        # Manages Cesium imagery layers & basemap switching
server.js                    # Express server + /api/projects and /tiles/* routes
db.js                        # PostgreSQL connection pool
import_tiles_to_db.js        # Tile import logic (shared module + CLI)
process_all_tifs.js          # Batch GeoTIFF → tile → database pipeline
```

---

# Flycam GIS Viewer (Tiếng Việt)

Hệ thống bản đồ 3D hiển thị ảnh chụp từ thiết bị bay (flycam/drone) trên nền [CesiumJS](https://cesium.com/platform/cesiumjs/). Dự án thay thế quy trình thủ công cũ (nhập tay tọa độ, lưu ảnh rời rạc theo folder) bằng một pipeline tự động, chuyển trực tiếp dữ liệu GeoTIFF gốc thành dịch vụ bản đồ vận hành trên database.

## Điểm nổi bật

- **Pipeline tự động GeoTIFF → Tile → Database.** Chỉ với 1 lệnh (`process_all_tifs.js`), hệ thống tự cắt ảnh `.tif` gốc thành tile theo chuẩn Web Mercator XYZ bằng GDAL, kiểm tra số lượng tile để đảm bảo nạp đủ, đưa vào PostgreSQL, rồi xóa file gốc — biến một quy trình nhiều bước thủ công thành một câu lệnh duy nhất.
- **Phục vụ ảnh bản đồ trực tiếp từ database.** Tile ảnh được lưu dạng nhị phân trong PostgreSQL và phát ra qua API Express (`/tiles/:project/:z/:x/:y.png`), ứng dụng không còn phụ thuộc vào file ảnh nằm trên ổ đĩa.
- **Không cần sửa code khi thêm dự án.** Dự án mới xử lý xong sẽ tự xuất hiện trên giao diện — frontend gọi `/api/projects` để tự dựng danh sách dự án, công cụ bật/tắt lớp ảnh, và vùng hiển thị trên bản đồ.
- **Hiểu đúng hệ tọa độ Việt Nam.** Xử lý chính xác hệ tọa độ quốc gia VN-2000/TM-3 múi 105°45' (EPSG:9210), bao gồm cả phép chuyển đổi datum sang WGS84 — tránh lỗi lệch vị trí âm thầm thường gặp khi chuyển đổi tọa độ không đúng cách.
- **Giảm dung lượng dữ liệu ở quy mô thực tế.** Đã xử lý hơn 100 bộ dữ liệu khảo sát (hàng chục GB ảnh gốc) thành một tập dữ liệu PostgreSQL gọn nhẹ, có thể truy vấn — giảm khoảng 75% dung lượng lưu trữ mà vẫn giữ nguyên độ chi tiết hiển thị ở các mức zoom 15–21.
- **Tích hợp sẵn công cụ GIS.** Đo khoảng cách & diện tích, hiển thị điểm độ cao (DEM), chuyển đổi bản đồ nền vệ tinh/đường phố, bay camera nhanh tới từng dự án.

## Công nghệ sử dụng

| Tầng | Công nghệ |
|---|---|
| Hiển thị bản đồ 3D | CesiumJS |
| Backend / API | Node.js, Express |
| Database | PostgreSQL (lưu tile dạng nhị phân) |
| Xử lý dữ liệu địa lý | GDAL (`gdal raster tile`), proj4 |
| Frontend | JavaScript thuần, dựng UI động |

## Cách hoạt động

```
File GeoTIFF gốc (.tif)
      │  gdal raster tile  (chuyển hệ tọa độ + cắt tile XYZ)
      ▼
Folder tile (tạm thời)
      │  process_all_tifs.js  (kiểm tra + nạp)
      ▼
PostgreSQL  ──  bảng tiles (dữ liệu PNG nhị phân)
            ──  bảng projects (vùng hiển thị, mức zoom, tên dự án)
      │
      ▼
API Express  /api/projects, /tiles/:project/:z/:x/:y.png
      │
      ▼
Frontend CesiumJS (danh sách dự án + lớp bản đồ tự dựng)
```

## Bắt đầu

### Yêu cầu

- Node.js >= 22
- PostgreSQL (đã test trên v17)
- GDAL có lệnh `gdal raster tile` (cài qua [OSGeo4W](https://www.osgeo.org/projects/osgeo4w/))

### Cài đặt

```bash
git clone https://github.com/huydevhehe/43G-flycam-gis-viewer.git
cd 43G-flycam-gis-viewer
npm install
```

Tạo file `.env` (tham khảo `.env.example`) với thông tin database của bạn:

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=mat_khau_cua_ban
DB_NAME=cesium_gis
```

Tạo database và bảng:

```sql
CREATE DATABASE cesium_gis;

CREATE TABLE tiles (
  project_key TEXT NOT NULL,
  z INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  data BYTEA NOT NULL,
  PRIMARY KEY (project_key, z, x, y)
);

CREATE TABLE projects (
  project_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  min_zoom INTEGER NOT NULL,
  max_zoom INTEGER NOT NULL,
  west DOUBLE PRECISION NOT NULL,
  south DOUBLE PRECISION NOT NULL,
  east DOUBLE PRECISION NOT NULL,
  north DOUBLE PRECISION NOT NULL
);
```

### Nạp dữ liệu ảnh khảo sát

Bỏ 1 hoặc nhiều file `.tif` vào thư mục gốc dự án, rồi chạy:

```bash
node process_all_tifs.js
```

Mọi file `.tif` mới sẽ được cắt tile, nạp vào PostgreSQL, và tự xóa file gốc. Dự án đã xử lý rồi sẽ tự được bỏ qua.

### Chạy ứng dụng

```bash
npm run start -- --port 3003 --public
```

Mở `http://localhost:3003/Apps/HelloWorld.html` — mọi dự án đã xử lý sẽ tự hiện trong danh sách lớp dữ liệu.

## Cấu trúc dự án

```
Apps/js/app.js              # Khởi tạo frontend: gọi /api/projects, dựng UI
Apps/js/MapManager.js        # Quản lý lớp ảnh Cesium & chuyển bản đồ nền
server.js                    # Server Express + route /api/projects và /tiles/*
db.js                        # Kết nối PostgreSQL
import_tiles_to_db.js        # Logic nạp tile (module dùng chung + CLI)
process_all_tifs.js          # Pipeline hàng loạt GeoTIFF → tile → database
```

---

**Developed by Nguyễn Quốc Huy**
