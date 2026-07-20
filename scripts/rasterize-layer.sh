#!/bin/bash
# Chạy toàn bộ pipeline raster-hoá 1 layer vector: xuất GeoJSON có màu ACI từ PostGIS ->
# rasterize 3 band RGB + 1 band alpha -> ghép ảnh -> cắt tile -> nạp vào bảng "tiles".
# Dùng: bash scripts/rasterize-layer.sh <layerKey> <maxZoom>
# Vi du: bash scripts/rasterize-layer.sh qhCnsdd 18
set -e

LAYER_KEY="$1"
MAX_ZOOM="${2:-18}"
MIN_ZOOM=15
RESOLUTION=0.5
PROJECT_KEY="vector_$(echo "$LAYER_KEY" | tr '[:upper:]' '[:lower:]')"
TMP_DIR="rasterize_tmp/$LAYER_KEY"

if [ -z "$LAYER_KEY" ]; then
  echo "Dung: bash scripts/rasterize-layer.sh <layerKey> [maxZoom, mac dinh 18]"
  echo "layerKey hop le: qhCnsdd, longDuong, tuyenDuong, timDuong, tenDuong, ranhB"
  exit 1
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "[1/5] Xuat GeoJSON tu PostGIS (co san R/G/B tra tu bang ACI)..."
node scripts/rasterize-prep.js "$LAYER_KEY" "$TMP_DIR/data.geojson"

echo "[2/5] Rasterize 3 band mau + 1 band trong suot (${RESOLUTION}m/pixel)..."
gdal_rasterize -a R -a_srs EPSG:3857 -tr $RESOLUTION $RESOLUTION -a_nodata 0 -ot Byte -of GTiff \
  "$TMP_DIR/data.geojson" "$TMP_DIR/band_R.tif"
gdal_rasterize -a G -a_srs EPSG:3857 -tr $RESOLUTION $RESOLUTION -a_nodata 0 -ot Byte -of GTiff \
  "$TMP_DIR/data.geojson" "$TMP_DIR/band_G.tif"
gdal_rasterize -a B -a_srs EPSG:3857 -tr $RESOLUTION $RESOLUTION -a_nodata 0 -ot Byte -of GTiff \
  "$TMP_DIR/data.geojson" "$TMP_DIR/band_B.tif"
gdal_rasterize -burn 255 -init 0 -a_srs EPSG:3857 -tr $RESOLUTION $RESOLUTION -ot Byte -of GTiff \
  "$TMP_DIR/data.geojson" "$TMP_DIR/band_A.tif"

echo "[3/5] Ghep 4 band thanh anh RGBA..."
gdalbuildvrt -separate "$TMP_DIR/merged.vrt" \
  "$TMP_DIR/band_R.tif" "$TMP_DIR/band_G.tif" "$TMP_DIR/band_B.tif" "$TMP_DIR/band_A.tif"
gdal_translate -of GTiff -colorinterp red,green,blue,alpha "$TMP_DIR/merged.vrt" "$TMP_DIR/rgba.tif"

echo "[4/5] Cat tile (zoom $MIN_ZOOM-$MAX_ZOOM)..."
gdal2tiles.py -z "$MIN_ZOOM-$MAX_ZOOM" -r cubic -w leaflet --xyz "$TMP_DIR/rgba.tif" "$TMP_DIR/tiles"

TILE_COUNT=$(find "$TMP_DIR/tiles" -name "*.png" | wc -l)
echo "  -> Da cat $TILE_COUNT tile."

echo "[5/5] Nap vao database (project_key = $PROJECT_KEY)..."
node import_tiles_to_db.js "$PROJECT_KEY" "$TMP_DIR/tiles"

echo ""
echo "XONG layer '$LAYER_KEY' -> project_key '$PROJECT_KEY', $TILE_COUNT tile."
echo "Don file tam de giai phong dia:"
rm -rf "$TMP_DIR"
echo "  -> Da xoa $TMP_DIR."
