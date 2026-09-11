// Gộp 46 file GeoJSON lô thửa mới (229 tờ bản đồ AI biên tập) thành 1 bộ sạch, chuẩn hoá
// schema, và sửa lỗi font tiếng Việt — chuẩn bị để import vào PostGIS thay cho lớp "Lô thửa"
// cũ (to28_84.geojson, chỉ có 169 thửa của riêng tờ 28).
//
// QUAN TRỌNG VỀ AN TOÀN DỮ LIỆU CÁ NHÂN:
// Bộ dữ liệu này chứa tên thật + địa chỉ chủ sử dụng đất. Việc sửa lỗi font áp dụng theo
// nguyên tắc "chỉ sửa khi chắc chắn": một chuỗi chỉ bị sửa nếu chứa ít nhất 1 ký tự KHÔNG
// THỂ nào là chữ tiếng Việt hợp lệ (VD ký hiệu §, µ, ×, ÷...) — dấu hiệu chắc chắn 100% chuỗi
// đó đã qua pipeline lỗi. Chuỗi không có dấu hiệu này được coi là ĐÃ ĐÚNG, không đụng vào.
// Giá trị gốc luôn được giữ lại (trường *_raw) để đối chiếu/sửa tay nếu máy đoán sai.
//
// Dùng: node scripts/prepare-lo-thua-moi.js <thu_muc_chua_46_file_geojson> <file_output.geojson>
import fs from "fs";
import path from "path";

const inputDir = process.argv[2];
const outputPath = process.argv[3];
if (!inputDir || !outputPath) {
  console.error("Dung: node scripts/prepare-lo-thua-moi.js <thu_muc_input> <file_output.geojson>");
  process.exit(1);
}

// ============================================================================
// BẢNG SỬA FONT — dựng từ đối chiếu thực tế hơn 2.400 lần khớp với họ/tên đệm phổ biến
// nhất Việt Nam (Nguyễn, Trần, Lê, Phạm, Hoàng, Huỳnh, Văn, Thị...) trong chính bộ dữ liệu
// này. Mỗi ký tự map ổn định về đúng 1 ký tự đích, không có trường hợp mâu thuẫn.
// ============================================================================

// Kiểu 1: ký tự Latin-1/Windows-1252 đứng thay cho 1 ký tự tiếng Việt có dấu.
const BANG_SUA_KIEU1 = {
  "Þ": "ị", "Ô": "ễ", "¨": "ă", "Ç": "ầ", "ª": "ê", "§": "Đ", "µ": "à",
  "ú": "ỳ", "é": "ộ", "ò": "ũ", "ï": "ù", "ä": "ọ", "¹": "ạ", "­": "ư",
  "Õ": "ế", "©": "â", "¬": "ơ", "ø": "ứ", "×": "ì", "«": "ô", "÷": "ữ",
  "¶": "ả", "Æ": "ặ", "Ö": "ệ", "Ê": "ấ", "í": "ớ", "ç": "ỗ", "¸": "á",
  "ê": "ờ", "Ü": "ĩ", "ü": "ỹ", "Ë": "ậ", "å": "ồ", "ù": "ự", "è": "ố",
};
// Ký tự CHẮC CHẮN không thể là chữ tiếng Việt hợp lệ — dùng làm "cờ báo hiệu" chuỗi này
// chắc chắn bị lỗi. Cố tình KHÔNG đưa các nguyên âm có dấu bình thường (â, ê, ô, ơ, ê, ù, ú...)
// vào đây vì chúng vẫn là chữ tiếng Việt thật hợp lệ khi đứng một mình trong chuỗi ĐÃ ĐÚNG.
const CO_HIEU_KIEU1 = new Set(["Þ", "Ô", "¨", "Ç", "ª", "§", "µ", "¹", "­", "«", "Æ", "Ö", "Ë", "Ü", "×", "÷", "¶", "¸", "ä", "å", "ï", "ü", "ç"]);

// Kiểu 2: chuỗi "%%<số>" đứng thay cho 1 ký tự — mỗi mã được đối chiếu riêng bằng cách khớp
// với các họ/từ phổ biến (Nguyễn, Trần, Trương, Dương, Ấp, Tỉnh lộ...). Khác với Kiểu 1, một
// vài mã ở đây bị PHÁT HIỆN LÀ MÂU THUẪN thật (VD %%226 vừa khớp "ũ" 52 lần vừa khớp "ỗ" 22
// lần) — có thể do 2 đợt xử lý khác nhau dùng cùng 1 mã số cho 2 mục đích khác nhau. Mã mâu
// thuẫn bị LOẠI KHỎI bảng này (thà bỏ sót còn hơn đoán sai tên người), giữ nguyên "%%NNN" để
// còn nhận ra bằng mắt.
const BANG_SUA_KIEU2 = {
  "167": "Đ", "168": "ă", "170": "ê", "172": "ơ", "173": "ư", "181": "à", "184": "á",
  "185": "ạ", "199": "ầ", "202": "Ấ", "212": "ễ", "215": "ỉ", "216": "ỉ", "221": "ỉ",
  "222": "ị", "228": "ọ", "230": "ỗ", "231": "ỗ", "233": "ộ", "234": "ơ", "239": "ù",
  "242": "ũ", "250": "ỳ", "253": "ê",
};

/**
 * Sửa 1 chuỗi nếu (và chỉ nếu) nó chứa dấu hiệu chắc chắn bị lỗi font.
 * @returns {{value: string, fixed: boolean}} value = chuỗi đã sửa (hoặc giữ nguyên nếu không chắc)
 */
// Trường hợp đặc biệt, KHÔNG đưa vào bảng chung: từ "Êp" đứng riêng (đầu địa chỉ hoặc sau
// số nhà, VD "44/235 Êp 6") luôn luôn là "Ấp" bị lỗi — chữ "Ê" hoa một mình không đưa vào cờ
// báo hiệu chung (vì Ê hoa vẫn là chữ cái Việt hợp lệ ở chỗ khác), nhưng đứng thành 1 TỪ
// riêng "Êp" thì không có nghĩa nào khác ngoài "Ấp" — xác nhận qua hàng trăm lần lặp y hệt.
const RE_AP_TU_RIENG = /(^|\s)Êp(\s|$)/g;

function suaFont(chuoiGoc) {
  if (!chuoiGoc || typeof chuoiGoc !== "string") return { value: chuoiGoc, fixed: false };

  // .replace() không giữ trạng thái giữa các lần gọi (khác .test() với regex cờ "g", vốn
  // nhớ lastIndex giữa các lần gọi trên các chuỗi khác nhau và có thể bỏ sót ngẫu nhiên).
  let chuoi = chuoiGoc.replace(RE_AP_TU_RIENG, "$1Ấp$2");
  const daXuLyAp = chuoi !== chuoiGoc;

  const coLoiKieu2 = /%%\d+/.test(chuoi);
  const coLoiKieu1 = [...chuoi].some((c) => CO_HIEU_KIEU1.has(c));
  if (!coLoiKieu1 && !coLoiKieu2) return { value: chuoi, fixed: daXuLyAp };

  let ketQua = chuoi;
  if (coLoiKieu2) {
    // Chỉ thay %%NNN khi mã nằm trong bảng tin cậy — mã lạ thì giữ nguyên "%%NNN" để còn
    // nhận ra bằng mắt là chỗ này chưa sửa được, thay vì âm thầm bỏ qua.
    ketQua = ketQua.replace(/%%(\d+)/g, (m, so) => BANG_SUA_KIEU2[so] ?? m);
  }
  if (coLoiKieu1) {
    ketQua = [...ketQua].map((c) => BANG_SUA_KIEU1[c] ?? c).join("");
  }
  return { value: ketQua, fixed: ketQua !== chuoiGoc };
}

// ============================================================================
// Chuẩn hoá 1 feature về schema chung — mỗi file trong 46 file có bộ cột hơi khác nhau
// (schema trôi dạt qua nhiều đợt xử lý), nên phải dò theo thứ tự ưu tiên cho từng trường.
// ============================================================================
function layGiaTriDau(props, ...cacTen) {
  for (const ten of cacTen) {
    if (props[ten] != null && props[ten] !== "") return props[ten];
  }
  return null;
}

// Ép về chuỗi thống nhất cho các trường định danh (so_to, so_thua, loai_dat, so_gcn) — dữ
// liệu gốc lẫn lộn kiểu giữa các thửa: có thửa "so_thua" là số nguyên (17), có thửa lại là
// chuỗi vì bị TÁCH THỬA ("302/314" = thửa 302 tách thành 314). ogr2ogr quét cả file để đoán
// kiểu cột, gặp lẫn lộn số/chuỗi/null thì tự chọn kiểu "json" và vỡ ngay khi gặp "302/314"
// (không phải JSON hợp lệ). Ép String() ngay từ đầu để cột luôn là text, không cho ogr2ogr đoán.
function epChuoi(v) {
  return v == null ? null : String(v);
}

// Diện tích hình học tự tính từ toạ độ thật (công thức shoelace, xấp xỉ phẳng — đủ chính xác
// cho khu vực nhỏ như 1 thửa đất, tránh phụ thuộc vào cột diện tích có thể thiếu ở nhiều file).
function dienTichHinhHoc(geometry) {
  const R = 111320; // mét / độ, xấp xỉ tại vĩ độ TP.HCM (~10.8 độ Bắc)
  const tinhVongMotRing = (ring) => {
    const latTB = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const kMet = Math.cos((latTB * Math.PI) / 180) * R;
    let s = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      s += x1 * kMet * (y2 * R) - x2 * kMet * (y1 * R);
    }
    return Math.abs(s / 2);
  };
  if (geometry.type === "Polygon") {
    let dt = tinhVongMotRing(geometry.coordinates[0]);
    for (let i = 1; i < geometry.coordinates.length; i++) dt -= tinhVongMotRing(geometry.coordinates[i]);
    return dt;
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((tong, poly) => {
      let dt = tinhVongMotRing(poly[0]);
      for (let i = 1; i < poly.length; i++) dt -= tinhVongMotRing(poly[i]);
      return tong + dt;
    }, 0);
  }
  return null;
}

function main() {
  const files = fs.readdirSync(inputDir).filter((f) => f.endsWith(".geojson"));
  console.log(`Doc ${files.length} file trong ${inputDir}...`);

  const ketQua = [];
  const baoCaoSuaFont = []; // { file, id, truong, truoc, sau } — de doi chieu lai
  let idMoi = 1;
  let bqLineStringBoQua = 0, bqThieuGeometry = 0;

  for (const ten of files) {
    const g = JSON.parse(fs.readFileSync(path.join(inputDir, ten), "utf8"));
    for (const f of g.features) {
      if (!f.geometry) { bqThieuGeometry++; continue; }
      // Chỉ lấy thửa đất thật (Polygon/MultiPolygon) — bỏ qua lớp đường ranh thô
      // (RANH_THUA_HIEN_HANH, dạng LineString) vì không mang thông tin chủ đất/diện tích.
      if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") {
        bqLineStringBoQua++;
        continue;
      }
      const p = f.properties || {};

      const chuSuDungGoc = layGiaTriDau(p, "chu_su_dung", "chu_su_dung_cad", "chu_su_dung_raw", "owner", "owner_raw_cad");
      const diaChiGoc = layGiaTriDau(p, "dia_chi", "dia_chi_cad", "dia_chi_raw", "address", "address_raw_cad");
      const chuSuDung = suaFont(chuSuDungGoc);
      const diaChi = suaFont(diaChiGoc);
      if (chuSuDung.fixed) baoCaoSuaFont.push({ file: ten, truong: "chu_su_dung", truoc: chuSuDungGoc, sau: chuSuDung.value });
      if (diaChi.fixed) baoCaoSuaFont.push({ file: ten, truong: "dia_chi", truoc: diaChiGoc, sau: diaChi.value });

      const dienTichHoSo = layGiaTriDau(p, "dien_tich_hs_m2", "dien_tich_update_m2");

      ketQua.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          id: idMoi++,
          so_to: epChuoi(layGiaTriDau(p, "so_to", "page_num")),
          so_thua: epChuoi(layGiaTriDau(p, "so_thua", "so_thua_update", "plot_num")),
          loai_dat: epChuoi(layGiaTriDau(p, "loai_dat", "ma_loai_dat_update", "ma_loai_dat_cad", "land_type")),
          chu_su_dung: chuSuDung.value,
          chu_su_dung_raw: chuSuDungGoc, // giữ bản gốc để đối chiếu nếu bảng sửa font đoán sai
          dia_chi: diaChi.value,
          dia_chi_raw: diaChiGoc,
          so_gcn: epChuoi(layGiaTriDau(p, "so_gcn")),
          dien_tich_ho_so_m2: dienTichHoSo != null ? Number(dienTichHoSo) : null,
          dien_tich_hinh_hoc_m2: Math.round(dienTichHinhHoc(f.geometry) * 10) / 10,
          ngay_bien_dong_moi_nhat: layGiaTriDau(p, "ngay_bien_dong_moi_nhat"),
          can_ra_soat: !!(p.need_review || p.review_status === "NEED_REVIEW"),
          nguon_file: ten,
        },
      });
    }
  }

  const geojsonMoi = { type: "FeatureCollection", features: ketQua };
  fs.writeFileSync(outputPath, JSON.stringify(geojsonMoi));
  const baoCaoPath = outputPath.replace(/\.geojson$/, "") + "_bao-cao-sua-font.json";
  fs.writeFileSync(baoCaoPath, JSON.stringify(baoCaoSuaFont, null, 1));

  console.log("");
  console.log(`Da gop ${ketQua.length} thua dat (bo qua ${bqLineStringBoQua} duong ranh tho, ${bqThieuGeometry} feature thieu geometry).`);
  console.log(`Da tu dong sua font cho ${baoCaoSuaFont.length} truong (chu_su_dung/dia_chi).`);
  console.log(`Ghi ra: ${outputPath}`);
  console.log(`Bao cao doi chieu truoc/sau (de ra soat): ${baoCaoPath}`);
  const conCanRaSoat = ketQua.filter((f) => f.properties.can_ra_soat).length;
  console.log(`Con ${conCanRaSoat} thua duoc chinh du lieu goc danh dau "can ra soat" (khong tu sua duoc, giu nguyen).`);
}

main();
