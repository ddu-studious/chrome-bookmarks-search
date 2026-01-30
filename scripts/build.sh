#!/bin/bash

# Chrome Bookmarks Search Extension - 打包脚本
# 用于生成可上传到 Chrome Web Store 的 zip 包

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 读取版本号
VERSION=$(grep '"version"' "$PROJECT_ROOT/manifest.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')

# 输出目录
DIST_DIR="$PROJECT_ROOT/dist"
PACKAGE_NAME="chrome-bookmarks-search-v${VERSION}.zip"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Chrome Bookmarks Search 打包工具${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "项目目录: ${YELLOW}$PROJECT_ROOT${NC}"
echo -e "版本号:   ${YELLOW}$VERSION${NC}"
echo ""

# 创建 dist 目录
mkdir -p "$DIST_DIR"

# 清理旧的打包文件
if [ -f "$DIST_DIR/$PACKAGE_NAME" ]; then
    echo -e "${YELLOW}删除旧的打包文件...${NC}"
    rm "$DIST_DIR/$PACKAGE_NAME"
fi

# 需要打包的文件列表
FILES_TO_PACK=(
    "manifest.json"
    "popup.html"
    "background.js"
    "css"
    "js"
    "icons"
)

# 检查文件是否存在
echo -e "${YELLOW}检查文件...${NC}"
for file in "${FILES_TO_PACK[@]}"; do
    if [ ! -e "$PROJECT_ROOT/$file" ]; then
        echo -e "${RED}错误: 文件或目录不存在 - $file${NC}"
        exit 1
    fi
    echo -e "  ✓ $file"
done
echo ""

# 创建临时目录
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# 复制文件到临时目录
echo -e "${YELLOW}复制文件...${NC}"
for file in "${FILES_TO_PACK[@]}"; do
    cp -r "$PROJECT_ROOT/$file" "$TEMP_DIR/"
done

# 创建 zip 包
echo -e "${YELLOW}创建 zip 包...${NC}"
cd "$TEMP_DIR"
zip -r "$DIST_DIR/$PACKAGE_NAME" . -x "*.DS_Store" -x "*__MACOSX*"

# 显示结果
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  打包完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "输出文件: ${YELLOW}$DIST_DIR/$PACKAGE_NAME${NC}"
echo -e "文件大小: ${YELLOW}$(du -h "$DIST_DIR/$PACKAGE_NAME" | cut -f1)${NC}"
echo ""
echo -e "${GREEN}下一步操作：${NC}"
echo "1. 打开 Chrome Web Store 开发者控制台"
echo "   https://chrome.google.com/webstore/devconsole"
echo "2. 选择你的扩展"
echo "3. 点击「软件包」标签页"
echo "4. 上传 $PACKAGE_NAME"
echo "5. 填写版本说明后提交审核"
echo ""
