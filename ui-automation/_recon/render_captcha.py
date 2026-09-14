"""把验证码图片渲染成 ASCII 字符画，便于用纯文本方式识别算术表达式。

用法：
  python render_captcha.py <图片路径> [列缩放]
输出：裁剪到字符区域后，用 '#' 表示深色像素、空格表示浅色像素。
"""
import sys
import numpy as np
from PIL import Image


def render(path: str, col_scale: int = 1) -> str:
    img = Image.open(path).convert('L')
    arr = np.array(img)

    # 去噪：验证码通常有干扰线，用中值滤波压一下
    try:
        import cv2
        arr = cv2.medianBlur(arr, 3)
    except Exception:
        pass

    # 二值化：深色像素视为字符
    binary = arr < 128

    rows = np.where(binary.any(axis=1))[0]
    cols = np.where(binary.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return '(图片为空或全白)'

    top, bottom = rows[0], rows[-1]
    left, right = cols[0], cols[-1]
    crop = binary[top:bottom + 1, left:right + 1]

    lines = [f'原始尺寸: {img.width}x{img.height}  字符区域: x={left}-{right}, y={top}-{bottom}']
    for row in crop:
        cells = []
        for x in range(0, len(row), col_scale):
            chunk = row[x:x + col_scale]
            cells.append('#' if chunk.mean() >= 0.5 else ('+' if chunk.mean() > 0 else ' '))
        lines.append(''.join(cells))
    return '\n'.join(lines)


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'captcha.png'
    scale = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    print(render(path, scale))
