# 🎙️ MeetFlow AI (스마트 회의록 & 전사 스튜디오)

> **"내 컴퓨터를 켜둘 필요 없이, 깃허브 페이지(GitHub Pages)만으로 100% 무료 동작하는 노션 AI 스타일 회의록 시스템"**
>
> 서버 유지비 0원, 호스팅 비용 0원! 방문자의 웹 브라우저 연산 자원과 무료 AI API(Web Speech API, Groq Whisper, Gemini)를 활용하여 상시 24시간 언제 어디서나 바로 사용할 수 있는 듀얼모드 웹 애플리케이션입니다.

- 🌐 **[MeetFlow AI 라이브 웹서비스 바로가기](https://ko9ma7.github.io/meetflow-ai/)**
- 📖 **[공식 사용 설명서 & 기능 백서 웹문서 (guide.html)](https://ko9ma7.github.io/meetflow-ai/guide.html)**

---

## 🌟 핵심 특징 (듀얼 아키텍처)

MeetFlow AI는 **로컬 PC 실행 모드**와 **깃허브 페이지 서버리스 모드**를 자동으로 감지하여 완벽하게 양방향 지원합니다:

| 구분 | 🌐 깃허브 페이지 (서버리스 모드) | 💻 로컬 PC 실행 모드 (`node server.js`) |
| :--- | :--- | :--- |
| **호스팅 환경** | **GitHub Pages (클라우드 상시 배포)** | 로컬 컴퓨터 (`http://localhost:3000`) |
| **PC 켜둘 필요** | ❌ **전혀 없음 (서버 0원, 24시간 가동)** | ⭕ 로컬 백엔드 실행 시 필요 |
| **데이터 저장소** | **브라우저 `localStorage` (방문자 PC 저장)** | 로컬 JSON 파일 (`data/meetings/`) |
| **실시간 마이크 전사** | **Web Speech API (무료, 무설정, 무제한)** | Faster-Whisper (16kHz PCM 스트리밍) |
| **영상/오디오 파일 전사** | **Groq Whisper Large-v3 (무료, 1초 초고속)** | Faster-Whisper 로컬 GPU/CPU 엔진 |
| **AI 4단 요약 & 액션** | **내장 스마트 요약 엔진 (0원) / Gemini 2.5 Flash** | Ollama / Gemini / Groq / OpenAI |
| **화자 분리 & 교정** | **브라우저 대화 턴 교정 엔진 (`[✨ AI 교정]`)** | Python F0 Pitch & MFCC 음향 클러스터링 |
| **서식 복사 & 내보내기** | **원클릭 노션 블록 복사 (`Ctrl+V`), 마크다운 다운로드** | 동일 지원 |

---

## 🚀 깃허브 페이지(GitHub Pages) 3분 배포 가이드

깃허브(GitHub) 계정만 있으면 내 컴퓨터를 꺼두어도 누구나 접속하여 회의록을 작성할 수 있는 나만의 웹서비스가 완성됩니다.

### 1단계: 깃허브 저장소 생성
1. [GitHub.com](https://github.com)에 로그인 후 우측 상단의 **[+ New repository]** 를 클릭합니다.
2. 저장소 이름(Repository name)을 입력합니다. (예: `meetflow` 또는 `meeting-notes`)
3. **Public**(공개)으로 설정하고 **[Create repository]** 버튼을 누릅니다.

### 2단계: 프로젝트 코드 업로드 (터미널)
프로젝트 폴더(`회의 기록하기`) 터미널 또는 PowerShell에서 아래 명령어를 차례로 입력합니다:

```bash
# 1. 변경된 모든 파일 추가
git add .

# 2. 커밋 메시지 작성
git commit -m "MeetFlow AI: GitHub Pages Serverless Web Service Release"

# 3. 기본 브랜치를 main으로 설정
git branch -M main

# 4. 내 깃허브 저장소 연결 (본인의 GitHub 계정명과 저장소 이름으로 변경)
git remote add origin https://github.com/<본인_깃허브_아이디>/<저장소_이름>.git

# 5. 깃허브로 업로드
git push -u origin main
```

### 3단계: GitHub Pages 활성화 (클릭 3번)
1. 깃허브 저장소 페이지 상단의 **[Settings]** 탭을 클릭합니다.
2. 좌측 메뉴에서 **[Pages]** 메뉴를 선택합니다.
3. **Build and deployment > Branch** 항목에서:
   - 브랜치: `main` 선택
   - 폴더: `/(root)` 선택
4. **[Save]** 버튼을 누릅니다.
5. 약 1분 후 새로고침하면 상단에 **`Your site is live at https://<아이디>.github.io/<저장소>/`** 링크가 나타납니다!

---

## 💡 브라우저 직결 무료 AI 연동 안내 (0원 운영)

깃허브 페이지에서는 사용자의 PC 브라우저가 직접 무료 API와 통신하므로, 저장소 관리자에게 어떠한 서버 비용도 청구되지 않습니다.

1. **실시간 음성 인식 (Web Speech API)**:
   - 크롬(Chrome) 및 엣지(Edge) 브라우저에 내장된 한국어 음성인식 엔진을 사용하여 별도 키 등록 없이도 마이크 대화가 실시간 텍스트로 기록됩니다.
2. **Groq Whisper Large-v3 (초고속 고정밀 전사)**:
   - [console.groq.com/keys](https://console.groq.com/keys)에서 무료 계정 가입 후 API 키를 생성하여 웹화면 좌측 하단 `⚙️ AI 모델 & STT 설정`에 입력하면, 장시간 오디오 및 유튜브 영상 녹음본을 1~2초 만에 완벽하게 텍스트로 변환합니다.
3. **Google Gemini 2.5 Flash (초정밀 회의 요약)**:
   - [Google AI Studio](https://aistudio.google.com/apikey)에서 무료 API 키를 발급받아 입력하면 최신 Gemini 2.5 Flash 모델이 노션 AI 스타일 4단 요약(개요/논의/결정/액션아이템)을 생성합니다.
   - 키를 입력하지 않더라도 **MeetFlow AI 내장 스마트 휴리스틱 엔진**이 브라우저에서 100% 무료로 요약본을 자동 작성합니다.

---

## 💻 로컬 PC 단독 실행 방법 (선택 사항)

인터넷 연결 없이 로컬 오프라인 환경에서 최고 보안으로 구동하고 싶을 때 사용합니다.

```bash
# 의존성 설치
npm install

# 서버 실행
npm start
# 또는 폴더 내 run.bat 더블 클릭
```
브라우저에서 `http://localhost:3000` 접속 시 자동으로 로컬 Node.js 백엔드 및 Faster-Whisper 엔진과 연결됩니다.

---

## 📂 프로젝트 구조

```
meetflow-ai/
├── index.html              # GitHub Pages 루트 진입점 (노션 UI 레이아웃)
├── style.css               # 노션 오리지널 디자인 시스템 & 반응형 CSS
├── app.js                  # 브라우저 스토리지, Web Speech, AI 직결 클라이언트
├── public/                 # 로컬 서버용 정적 파일 미러
├── server.js               # 로컬 실행용 Node.js REST API 서버
├── transcribe.py           # 로컬 실행용 Faster-Whisper & MFCC 음향 클러스터링
├── run.bat                 # 윈도우 원클릭 로컬 실행 스크립트
└── package.json            # 로컬 프로젝트 패키지 메타데이터
```

---

## 📄 라이선스
MIT License
