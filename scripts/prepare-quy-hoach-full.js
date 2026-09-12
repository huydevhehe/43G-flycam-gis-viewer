// Loc bo lop "duong_ranh_quy_hoach" (LineString tho, khong mang thong tin) khoi bo Quy hoach
// FULL Binh Tan V2, chi giu lai "polygon_quy_hoach" (1.295 vung co chuc_nang_qh that) de import.
// Dung: node scripts/prepare-quy-hoach-full.js <file_input.geojson> <file_output.geojson>
import fs from "fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error("Dung: node scripts/prepare-quy-hoach-full.js <file_input.geojson> <file_output.geojson>");
  process.exit(1);
}

const g = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const features = g.features.filter((f) => f.properties?.nhom_du_lieu === "polygon_quy_hoach");

fs.writeFileSync(outputPath, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`Da loc ${features.length}/${g.features.length} feature (chi giu polygon_quy_hoach).`);
console.log(`Ghi ra: ${outputPath}`);
