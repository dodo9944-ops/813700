from PIL import Image
import sys
import os

def convert_to_black_white(input_path, output_path=None):
    img = Image.open(input_path)
    bw_img = img.convert("L")  # 흑백(그레이스케일) 변환

    if output_path is None:
        name, ext = os.path.splitext(input_path)
        output_path = f"{name}_black{ext}"

    bw_img.save(output_path)
    print(f"저장 완료: {output_path}")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python convert_to_black.py <이미지파일>")
        sys.exit(1)
    convert_to_black_white(sys.argv[1])
