import { fromFile } from "geotiff";
import fs from "fs";
import path from "path";

const projects = [
  {
    name: "TruongTieuhoc-BTD",
    tif: "Apps/SampleData/TruongTieuhoc-BTD_dem.tif",
    json: "Apps/SampleData/TruongTieuhoc-BTD_elevation.json",
    stepX: 70, // Đảm bảo số lượng điểm vừa phải (~100-300 điểm) để tránh lag
    stepY: 70
  },
  {
    name: "Duong4KDC_ThangLong_VuonTre",
    tif: "Apps/SampleData/Duong4KDC_ThangLong_VuonTre_dem.tif",
    json: "Apps/SampleData/Duong4KDC_ThangLong_VuonTre_elevation.json",
    stepX: 70,
    stepY: 70
  },
  {
    name: "NhaXuong_CCHaiThanh",
    tif: "Apps/SampleData/NhaXuong_CCHaiThanh_dem.tif",
    json: "Apps/SampleData/NhaXuong_CCHaiThanh_elevation.json",
    stepX: 70,
    stepY: 70
  }
];

async function processProject(proj) {
  try {
    console.log(`\n==========================================`);
    console.log(`ĐANG XỬ LÝ DỰ ÁN: ${proj.name}`);
    console.log(`Đọc file TIF: ${proj.tif}...`);
    
    if (!fs.existsSync(proj.tif)) {
      console.error(`Lỗi: Không tìm thấy file ${proj.tif}`);
      return;
    }

    const tiff = await fromFile(proj.tif);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    
    console.log(`Kích thước DEM: ${width} x ${height}`);
    console.log(`Bounding Box: [Kinh: ${bbox[0]} -> ${bbox[2]}, Vĩ: ${bbox[1]} -> ${bbox[3]}]`);
    
    const rasters = await image.readRasters();
    const elevationData = rasters[0];
    
    const minX = bbox[0];
    const minY = bbox[1];
    const maxX = bbox[2];
    const maxY = bbox[3];
    
    const pixelWidth = (maxX - minX) / width;
    const pixelHeight = (maxY - minY) / height;
    
    let noDataValue = image.getGDALNoData();
    if (noDataValue === null || noDataValue === undefined) {
      noDataValue = -32767; // Mặc định NoData của GDAL Float32 thường dùng
    }
    console.log(`GDAL NoData Value: ${noDataValue}`);

    const points = [];
    let id = 1;
    
    // Tự động điều chỉnh bước nhảy để số lượng điểm trích xuất nằm trong khoảng 100 - 300 điểm
    // Giúp tối ưu hóa hiệu năng render marker của Cesium trên mobile
    let stepX = proj.stepX;
    let stepY = proj.stepY;
    const totalPixels = width * height;
    
    // Nếu ảnh quá lớn hoặc quá nhỏ, điều chỉnh bước nhảy
    if (width > 2000 || height > 2000) {
      stepX = 100;
      stepY = 100;
    } else if (width < 800 && height < 800) {
      stepX = 35;
      stepY = 35;
    }

    console.log(`Lấy mẫu với bước nhảy (step): ${stepX} x ${stepY}`);

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const idx = y * width + x;
        const val = elevationData[idx];
        
        // Bỏ qua các điểm NoData, NaN hoặc giá trị lỗi bất thường ngoài khoảng thực tế (-20m đến 300m)
        if (val === noDataValue || isNaN(val) || val < -20 || val > 300) {
          continue;
        }
        
        const lon = minX + x * pixelWidth;
        const lat = maxY - y * pixelHeight;
        
        points.push({
          id: id++,
          lon: Number(lon.toFixed(7)),
          lat: Number(lat.toFixed(7)),
          elevation: Number(val.toFixed(2))
        });
      }
    }
    
    // Ghi ra file JSON
    fs.writeFileSync(proj.json, JSON.stringify(points, null, 2), "utf8");
    
    console.log(`ĐÃ TRÍCH XUẤT THÀNH CÔNG!`);
    console.log(`- Số điểm trích xuất: ${points.length} điểm.`);
    if (points.length > 0) {
      const elevations = points.map(p => p.elevation);
      console.log(`- Điểm cao nhất: ${Math.max(...elevations)} m`);
      console.log(`- Điểm thấp nhất: ${Math.min(...elevations)} m`);
    }
    console.log(`- File kết quả lưu tại: ${proj.json}`);
    console.log(`==========================================`);
    
  } catch (err) {
    console.error(`Lỗi khi xử lý dự án ${proj.name}:`, err);
  }
}

async function main() {
  for (const proj of projects) {
    await processProject(proj);
  }
  console.log("\n>>> ĐÃ HOÀN THÀNH XỬ LÝ TẤT CẢ DỰ ÁN! <<<");
}

main();
