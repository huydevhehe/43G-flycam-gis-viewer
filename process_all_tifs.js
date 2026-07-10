// Xử lý hàng loạt: quét toàn bộ file .tif ở thư mục gốc dự án, với mỗi file CHƯA có trong
// bảng "projects": cắt tile bằng GDAL -> nạp vào DB -> nếu khớp số lượng thì xóa file .tif
// gốc + folder tile (vì ảnh giờ chỉ phục vụ từ database).
// Dùng: node process_all_tifs.js                  (xử lý hết toàn bộ file .tif mới)
// Dùng: node process_all_tifs.js Ten1.tif Ten2.tif (chỉ xử lý các file chỉ định, để test trước)
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import pool from "./db.js";
import { importTilesForProject, countPngTiles } from "./import_tiles_to_db.js";

const isWindows = process.platform === "win32";
const GDAL_EXE = process.env.GDAL_EXE || (isWindows ? "C:\\OSGeo4W\\bin\\gdal.exe" : "gdal2tiles.py");
const GDAL_DATA = process.env.GDAL_DATA || (isWindows ? "C:\\OSGeo4W\\apps\\gdal\\share\\gdal" : null);
const ROOT_DIR = process.env.TIF_DIR || (isWindows ? path.resolve("..") : path.resolve("."));
const TILE_OUTPUT_DIR = path.resolve("anh");
const MIN_ZOOM = 15;
const MAX_ZOOM = 21;

function cutTiles(tifPath, outputDir) {
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  const cmd = isWindows
    ? [
        `"${GDAL_EXE}"`,
        "raster tile",
        "--tiling-scheme WebMercatorQuad",
        "--convention xyz",
        `--min-zoom ${MIN_ZOOM}`,
        `--max-zoom ${MAX_ZOOM}`,
        "-r cubic",
        "--webviewer leaflet",
        `-i "${tifPath}"`,
        `-o "${outputDir}"`,
      ].join(" ")
    : [
        `"${GDAL_EXE}"`,
        `-z ${MIN_ZOOM}-${MAX_ZOOM}`,
        "-r cubic",
        "-w leaflet",
        "--xyz",
        `"${tifPath}"`,
        `"${outputDir}"`,
      ].join(" ");
  const env = GDAL_DATA ? { ...process.env, GDAL_DATA } : { ...process.env };
  execSync(cmd, { env, stdio: "pipe" });
}

// Đọc leaflet.html GDAL tự sinh, lấy bbox WGS84 thật từ dòng fitBounds([[lat1,lon1],[lat2,lon2]])
function readBboxFromLeaflet(leafletPath) {
  const html = fs.readFileSync(leafletPath, "utf8");
  const match = html.match(
    /fitBounds\(\[\[([\d.\-]+),\s*([\d.\-]+)\],\s*\[([\d.\-]+),\s*([\d.\-]+)\]\]\)/,
  );
  if (!match) {
    throw new Error("Khong tim thay fitBounds trong leaflet.html");
  }
  const lats = [Number(match[1]), Number(match[3])];
  const lons = [Number(match[2]), Number(match[4])];
  return {
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

function removeDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

async function main() {
  const existing = await pool.query("SELECT project_key FROM projects");
  const processedKeys = new Set(existing.rows.map((r) => r.project_key));

  const onlyFiles = process.argv.slice(2);
  const tifFiles = fs
    .readdirSync(ROOT_DIR)
    .filter((f) => f.toLowerCase().endsWith(".tif"))
    .filter((f) => !processedKeys.has(path.basename(f, ".tif")))
    .filter((f) => onlyFiles.length === 0 || onlyFiles.includes(f));

  if (tifFiles.length === 0) {
    console.log("Khong co file .tif moi can xu ly.");
    await pool.end();
    return;
  }

  console.log(`Tim thay ${tifFiles.length} file .tif moi can xu ly.`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < tifFiles.length; i++) {
    const fileName = tifFiles[i];
    const projectKey = path.basename(fileName, ".tif");
    const tifPath = path.join(ROOT_DIR, fileName);
    const outputDir = path.join(TILE_OUTPUT_DIR, `${projectKey}_fixed`);
    const prefix = `[${i + 1}/${tifFiles.length}] ${projectKey}`;

    try {
      console.log(`${prefix}: dang cat tile...`);
      cutTiles(tifPath, outputDir);

      const bbox = readBboxFromLeaflet(path.join(outputDir, "leaflet.html"));
      const expectedCount = countPngTiles(outputDir);

      console.log(`${prefix}: dang nap ${expectedCount} tile vao DB...`);
      const insertedCount = await importTilesForProject(projectKey, outputDir);

      if (insertedCount !== expectedCount) {
        throw new Error(
          `So tile nap vao DB (${insertedCount}) khong khop so file PNG thuc te (${expectedCount})`,
        );
      }

      // Không set group_key: dự án của instance này luôn để NULL (chưa gán nhóm).
      // DO UPDATE cố ý không đụng group_key — DB dùng chung với instance kia,
      // script này không được phép đổi nhóm của dự án đã tồn tại.
      await pool.query(
        `INSERT INTO projects (project_key, title, min_zoom, max_zoom, west, south, east, north)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (project_key) DO UPDATE SET
           title = EXCLUDED.title, min_zoom = EXCLUDED.min_zoom, max_zoom = EXCLUDED.max_zoom,
           west = EXCLUDED.west, south = EXCLUDED.south, east = EXCLUDED.east, north = EXCLUDED.north`,
        [projectKey, `Dự án ${projectKey}`, MIN_ZOOM, MAX_ZOOM,
         bbox.west, bbox.south, bbox.east, bbox.north],
      );

      removeDir(outputDir);
      fs.rmSync(tifPath, { force: true });

      console.log(`${prefix}: xong (${insertedCount} tile, da xoa file goc + folder tile).`);
      ok++;
    } catch (err) {
      console.error(`${prefix}: LOI - ${err.message}`);
      console.error(`${prefix}: giu nguyen file .tif goc + folder tile (neu co) de debug.`);
      failed++;
    }
  }

  console.log(`\nHoan tat: ${ok} thanh cong, ${failed} loi.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
