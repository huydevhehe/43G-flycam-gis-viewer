import fs from 'fs';
import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

async function main() {
    const filePath = process.argv[2] || 'test1.tif';
    console.log(`Reading GeoTIFF from: ${filePath}`);

    try {
        const data = fs.readFileSync(filePath);
        // Ensure we pass a proper ArrayBuffer (data.buffer might be a Buffer's shared ArrayBuffer, so slice it)
        const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        const tiff = await fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();

        const width = image.getWidth();
        const height = image.getHeight();
        console.log('Image dimensions:', width, 'x', height);

        // Print the geo-keys
        const geoKeys = image.getGeoKeys();
        console.log('\nGeoKeys:');
        console.log(JSON.stringify(geoKeys, null, 2));

        // geotiff v3 API: bbox = [west, south, east, north] trong CRS gốc (mét, VN-2000/TM-3)
        const [bWest, bSouth, bEast, bNorth] = image.getBoundingBox();
        console.log('\nBoundingBox gốc (Easting/Northing - VN-2000/TM-3 105-45):', [bWest, bSouth, bEast, bNorth]);

        const corners = {
            topLeft: [bWest, bNorth],
            topRight: [bEast, bNorth],
            bottomLeft: [bWest, bSouth],
            bottomRight: [bEast, bSouth],
        };

        // Định nghĩa CRS từ chính GeoKeys đã đọc được:
        // ProjNatOriginLongGeoKey=105.75, ProjFalseEastingGeoKey=500000, ProjScaleAtNatOriginGeoKey=0.9999
        const vn2000tm3 = '+proj=tmerc +lat_0=0 +lon_0=105.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs';
        const wgs84 = 'EPSG:4326';

        console.log('\nGóc ảnh quy đổi sang WGS84 (lon, lat):');
        const wgs84Corners = {};
        for (const [name, [e, n]] of Object.entries(corners)) {
            const [lon, lat] = proj4(vn2000tm3, wgs84, [e, n]);
            wgs84Corners[name] = [lon, lat];
        }
        console.log(JSON.stringify(wgs84Corners, null, 2));

        const lons = Object.values(wgs84Corners).map(c => c[0]);
        const lats = Object.values(wgs84Corners).map(c => c[1]);
        console.log('\nBBox WGS84 (west, south, east, north):');
        console.log([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);

    } catch (e) {
        console.error('Error reading GeoTIFF:', e);
    }
}

main();
