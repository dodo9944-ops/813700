import cv2
import numpy as np
import sys
import os


def make_bald(input_path, output_path=None):
    img = cv2.imread(input_path)
    if img is None:
        print(f"이미지를 불러올 수 없습니다: {input_path}")
        sys.exit(1)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 얼굴 감지
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))

    if len(faces) == 0:
        print("얼굴을 감지하지 못했습니다. 이미지를 확인해주세요.")
        sys.exit(1)

    x, y, w, h = faces[0]

    # 머리카락 영역: 얼굴 위쪽 + 얼굴 상단 1/4 포함
    hair_top = max(0, y - int(h * 0.9))
    hair_bottom = y + h // 4
    hair_left = max(0, x - w // 6)
    hair_right = min(img.shape[1], x + w + w // 6)

    # 피부 톤 샘플링 (이마 부근)
    skin_y1 = y
    skin_y2 = y + h // 6
    skin_x1 = x + w // 4
    skin_x2 = x + 3 * w // 4
    skin_sample = img[skin_y1:skin_y2, skin_x1:skin_x2]
    skin_color = skin_sample.mean(axis=(0, 1)).astype(np.uint8)

    # HSV 색공간에서 어두운 영역(머리카락) 마스크 생성
    hair_region_bgr = img[hair_top:hair_bottom, hair_left:hair_right]
    hsv = cv2.cvtColor(hair_region_bgr, cv2.COLOR_BGR2HSV)

    # 어두운 픽셀 (V < 80) 또는 채도 높고 어두운 색
    lower_dark = np.array([0, 0, 0])
    upper_dark = np.array([180, 255, 90])
    mask_dark = cv2.inRange(hsv, lower_dark, upper_dark)

    # 모폴로지 처리로 마스크 정리
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask_dark = cv2.morphologyEx(mask_dark, cv2.MORPH_CLOSE, kernel)
    mask_dark = cv2.morphologyEx(mask_dark, cv2.MORPH_DILATE, kernel)

    # 전체 이미지 마스크 생성
    full_mask = np.zeros(img.shape[:2], dtype=np.uint8)
    full_mask[hair_top:hair_bottom, hair_left:hair_right] = mask_dark

    # 얼굴 영역은 마스크에서 제외 (얼굴 아랫부분 보호)
    face_protect_y = y + h // 4
    full_mask[face_protect_y:, :] = 0

    # 마스크 영역을 피부 톤으로 먼저 채우기
    result = img.copy()
    skin_fill = np.full_like(img, skin_color)
    result[full_mask > 0] = skin_fill[full_mask > 0]

    # OpenCV inpaint로 자연스럽게 블렌딩
    result = cv2.inpaint(result, full_mask, 15, cv2.INPAINT_TELEA)

    if output_path is None:
        name, ext = os.path.splitext(input_path)
        output_path = f"{name}_bald{ext}"

    cv2.imwrite(output_path, result)
    print(f"저장 완료: {output_path}")
    return output_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python make_bald.py <이미지파일>")
        sys.exit(1)
    make_bald(sys.argv[1])
