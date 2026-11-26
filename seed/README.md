<!-- SPDX-License-Identifier: Apache-2.0 -->
# 샘플 콘텐츠

첫 실행 시 `poster-autumn.png`, `poster-welcome.png`, `poster-class.png`, `sample-video.mp4`가 업로드 폴더로 복사되고 샘플 재생목록 ‘로비 기본 순환’이 만들어집니다.

- 포스터 3종: 이 저장소를 위해 제작한 가상 예시 이미지입니다. 실제 공연 정보가 아닙니다.
- `sample-video.mp4`: **Big Buck Bunny** 일부를 640×360, 10초 H.264로 변환한 테스트 클립입니다. 원작 Copyright 2008 Blender Foundation / www.bigbuckbunny.org, CC BY 3.0. 파일 출처는 [Test Videos의 360p MP4](https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4)이며, 이 사이트는 영상을 FFmpeg로 변환하고 원작과 같은 조건으로 사용할 수 있다고 밝힙니다. 원작의 라이선스와 발췌물 귀속 예시는 [Blender 공식 페이지](https://peach.blender.org/about/)를 참고하세요. SHA-256: `77145c94c11f3754207499158df22406e1fe7635553c1c86dc5e881dfeb32016`. 원 배포 사이트가 체크섬을 공개하지 않아 링크된 원본과 바이트 일치는 검증하지 못했습니다.
- SVG 원본은 `seed/source/`에 있습니다. 포스터 PNG는 아래 명령으로 SVG에서 직접 다시 만들 수 있습니다.

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts\render-seed-posters.ps1
```

2026-11-26 기준 Microsoft Edge 158.0.4370.33 헤드리스·SwiftShader 렌더 결과입니다.

| PNG | 크기 | SHA-256 |
|---|---:|---|
| `poster-autumn.png` | 1920×1080 | `bf08a50e35cda6d97083f7fd1224815df865f45792068d886512ffbc91949ae3` |
| `poster-class.png` | 1920×1080 | `822c1836ef72e2bb77f318b91adef5c93346523ca5a5c8cf74214fe88d24cd7a` |
| `poster-welcome.png` | 1080×1920 | `532dfd557e1ecec2cf43164a5a9c6a3c14db067d0cc816d6d026b9ccb96fa404` |

다시 생성된 기본 샘플은 테스트용 자산입니다. seed 로직은 `samples_seeded` 기록을 유지하고, 같은 경로에 이미 있는 파일을 덮어쓰지 않습니다. 기존 사용자 콘텐츠 보존 회귀 테스트는 `test/sample-neutral.test.ts`에 있습니다.

샘플을 끄려면 `SEED_SAMPLES=false`로 실행하세요. 이미 만들어진 데이터는 자동으로 지워지지 않습니다.
