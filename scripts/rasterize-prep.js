// Chuẩn bị dữ liệu để rasterize 1 layer vector Tân Bình: đọc geometry + mã màu ACI từ PostGIS,
// tra bảng scripts/aciPalette.json ra RGB, ghi ra file GeoJSON có thêm field R,G,B cho từng
// feature — dùng làm input cho gdal_rasterize (mỗi field burn vào 1 band ảnh riêng).
// Dùng: node scripts/rasterize-prep.js <layerKey> <duongDanFileOutput.geojson>
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const aciPalette = JSON.parse(fs.readFileSync(path.join(__dirname, "aciPalette.json"), "utf8"));

const LAYER_TABLES = {
  qhCnsdd: "vec_qh_cnsdd",
  longDuong: "vec_long_duong",
  tuyenDuong: "vec_tuyen_duong",
  timDuong: "vec_tim_duong",
  tenDuong: "vec_ten_duong",
  ranhB: "vec_ranh_b",
};

// Layer không có dữ liệu màu ACI gốc (ranhB chỉ là 1 polygon ranh giới, không phải đối tượng CAD
// có tô màu) — cho màu cố định. #DC2626 = rgb(220,38,38), khớp màu viền đã dùng trước đó.
const FIXED_COLOR = {
  ranhB: [220, 38, 38],
};

// Màu hồng chói dùng khi gặp mã ACI lạ (không có trong bảng 1-255) — cố tình chọn màu dễ
// nhận ra bằng mắt để phát hiện lỗi tra bảng, không lẫn với màu ACI thật nào.
const FALLBACK_COLOR = [255, 0, 255];

async function main() {
  const layerKey = process.argv[2];
  const outputPath = process.argv[3];
  const table = LAYER_TABLES[layerKey];

  if (!table || !outputPath) {
    console.error("Dung: node scripts/rasterize-prep.js <layerKey> <duongDanFileOutput.geojson>");
    console.error("layerKey hop le:", Object.keys(LAYER_TABLES).join(", "));
    process.exit(1);
  }

  // ST_Force2D bỏ toạ độ Z (dữ liệu gốc là PolygonZ/MultiLineStringZ do xuất từ CAD 3D) —
  // gdal_rasterize chỉ cần X/Y, giữ Z lại không có lợi gì mà thêm rủi ro parse sai.
  const hasColor = !FIXED_COLOR[layerKey];
  const columns = hasColor
    ? "id, color, ST_AsGeoJSON(ST_Force2D(geom)) AS geojson"
    : "id, ST_AsGeoJSON(ST_Force2D(geom)) AS geojson";
  const result = await pool.query(`SELECT ${columns} FROM ${table}`);

  let fallbackCount = 0;
  const features = result.rows.map((row) => {
    let rgb;
    if (hasColor) {
      rgb = aciPalette[String(row.color)];
      if (!rgb) {
        fallbackCount++;
        rgb = FALLBACK_COLOR;
      }
    } else {
      rgb = FIXED_COLOR[layerKey];
    }
    return {
      type: "Feature",
      geometry: JSON.parse(row.geojson),
      properties: { R: rgb[0], G: rgb[1], B: rgb[2] },
    };
  });

  fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features }));

  console.log(`Đã ghi ${features.length} feature vào ${outputPath}.`);
  if (fallbackCount > 0) {
    console.warn(`CẢNH BÁO: ${fallbackCount} feature dùng mã ACI không có trong bảng, đã tô màu hồng dự phòng.`);
  }

  await pool.end();
}

main();
