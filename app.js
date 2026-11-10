/**
 * MeetFlow AI - Modern Document Workspace & Transcription Engine
 * Features:
 *  - Document-first ergonomics with clean, modern brand styling
 *  - Live microphone, YouTube/PC loopback audio, and 60MB+ streaming upload
 *  - Speaker Diarization & Real-time Speaker Name Mapping
 *  - Multi-direction AI Prompt Package Studio (ChatGPT / Claude / Gemini ready)
 *  - In-app AI summary execution & Audio timestamp syncing
 */

// Application State
const state = {
  currentMeetingId: null,
  title: '새 회의록',
  date: new Date().toISOString().split('T')[0],
  attendees: '',
  category: '내 회의',
  agenda: '',
  notes: '',
  audioUrl: null,
  duration: 0,
  dialogues: [], // Array of { time, speaker, originalSpeaker, text, start_seconds }
  speakerMap: {}, // e.g. { '화자 1': '박태훈 의장', '화자 2': '최욱 진행자' }
  targetSpeakerCount: localStorage.getItem('meetflow_speaker_cap') || '3',
  selectedPreset: 'executive',
  customInstruction: '',
  summary: null,
  isRecording: false,
  isPaused: false,
  recordingSeconds: 0,
  timerInterval: null,
  audioContext: null,
  analyser: null,
  audioStream: null,
  mediaRecorder: null,
  audioChunks: [],
  settings: {
    sttEngine: localStorage.getItem('meetflow_stt_engine') || 'auto-detect',
    summaryProvider: localStorage.getItem('meetflow_summary_provider') || 'local',
    apiKey: localStorage.getItem('meetflow_apikey') || '',
    groqKey: localStorage.getItem('meetflow_groq_key') || '',
    backendUrl: localStorage.getItem('meetflow_backend_url') || ''
  }
};

// Universal Storage Adapter (Seamlessly supports both Node.js Backend & Serverless GitHub Pages)
const StorageAdapter = {
  _isLocalBackend: null,

  async hasBackend() {
    if (this._isLocalBackend !== null) return this._isLocalBackend;
    try {
      const res = await fetch('/api/meetings', { method: 'GET' });
      this._isLocalBackend = res.ok;
    } catch (_) {
      this._isLocalBackend = false;
    }
    return this._isLocalBackend;
  },

  async listMeetings() {
    if (await this.hasBackend()) {
      try {
        const res = await fetch('/api/meetings');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    return this.listLocal();
  },

  listLocal() {
    try {
      const raw = localStorage.getItem('meetflow_meetings_index') || '[]';
      return JSON.parse(raw);
    } catch (_) {
      return [];
    }
  },

  async getMeeting(id) {
    if (await this.hasBackend()) {
      try {
        const res = await fetch(`/api/meetings/${id}`);
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    try {
      const raw = localStorage.getItem(`meetflow_meeting_${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  async saveMeeting(payload) {
    if (await this.hasBackend()) {
      try {
        await fetch('/api/meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (_) {}
    }

    try {
      localStorage.setItem(`meetflow_meeting_${payload.id}`, JSON.stringify(payload));
      const list = this.listLocal();
      const existingIdx = list.findIndex(m => m.id === payload.id);
      const meta = {
        id: payload.id,
        title: payload.title || '새 회의록',
        date: payload.date || '오늘',
        duration: payload.duration || 0,
        category: payload.category || '내 회의',
        updatedAt: new Date().toISOString(),
        hasSummary: !!payload.summary,
        transcriptLength: (payload.dialogues || []).length
      };
      if (existingIdx >= 0) {
        list[existingIdx] = meta;
      } else {
        list.unshift(meta);
      }
      localStorage.setItem('meetflow_meetings_index', JSON.stringify(list));
    } catch (e) {
      console.warn('Local storage error:', e);
    }
    return payload;
  },

  async deleteMeeting(id) {
    if (await this.hasBackend()) {
      try {
        await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
      } catch (_) {}
    }
    localStorage.removeItem(`meetflow_meeting_${id}`);
    const list = this.listLocal().filter(m => m.id !== id);
    localStorage.setItem('meetflow_meetings_index', JSON.stringify(list));
  }
};

// Preset Definitions with rich prompt instructions
const PRESETS = {
  executive: {
    name: '경영진 핵심 요약 보고서',
    icon: '🏢',
    instruction: `[경영진 및 C-Level 의사결정권자 보고용 브리핑 지침]
- 사소한 잡담 및 서론은 일체 배제하고 가장 중요한 비즈니스 핵심만 요약하세요.
- 출력 구조:
  1. 📌 핵심 3줄 요약 (Executive Bullet Points)
  2. ⚖️ 주요 의사결정 사항 (확정된 사항 및 합의된 방향)
  3. ⚠️ 핵심 리스크 요인 및 대응 방안
  4. 📈 비즈니스 영향도 및 기대 효과`
  },
  action_items: {
    name: '실무 액션 태스크 & 업무 분장',
    icon: '📋',
    instruction: `[실무진 업무 분장 및 액션 아이템 지침]
- 회의에서 언급된 모든 실무 작업을 담당자별 체크리스트로 추출하세요.
- 출력 구조:
  1. 🎯 회의 목표 달성 여부 요약
  2. 📋 담당자별 액션 아이템 (담당자 | 구체적 작업 내용 | 마감 기한 | 우선순위[상/중/하])
  3. 🔗 업무 간 선행 조건 및 의존성 관계
  4. 📅 차기 회의 및 중간 체크 일정`
  },
  technical: {
    name: '기술 개발 & 엔지니어링 미팅',
    icon: '💻',
    instruction: `[엔지니어링 & 시스템 아키텍처 회의록 지침]
- 개발팀 및 기술 조직을 위해 기술적 결정과 구현 세부사항을 구조화하세요.
- 출력 구조:
  1. 🏗️ 시스템 아키텍처 및 설계 결정 사항
  2. 🔌 API / 데이터 스키마 / 인터페이스 변경 규격
  3. 🐛 식별된 기술적 병목, 버그 및 해결 전략
  4. 🧪 단위/통합 테스트 계획 및 인프라 요구사항`
  },
  sales_interview: {
    name: '고객 미팅 & VOC 분석',
    icon: '🤝',
    instruction: `[고객사 인터뷰 및 영업 VOC 분석 지침]
- 고객의 핵심 피드백과 비즈니스 기회 요인을 집중 분석하세요.
- 출력 구조:
  1. 👤 고객사 현황 및 미팅 배경
  2. 💡 고객 핵심 요구사항 및 페인포인트(Pain Points)
  3. 💼 제안 사항 및 고객의 반응/피드백
  4. 📅 후속 영업 팔로업 일정 및 견적/계약 조율 항목`
  },
  qa_decision: {
    name: '의사결정 렛저 & 안건별 찬반',
    icon: '⚖️',
    instruction: `[의사결정 렛저(Decision Ledger) 지침]
- 회의에서 다룬 안건별로 논의된 옵션과 최종 결정을 기록하세요.
- 출력 구조:
  1. 📖 논의 안건 목록
  2. ⚖️ 안건별 상세 (안건명 | 대립된 의견/옵션 | 최종 채택안 및 그 근거 | 기각/보류된 이유)
  3. ❓ 미해결 질문 및 추가 조사가 필요한 사항`
  },
  email: {
    name: '팀 공유용 이메일/슬랙 공지문',
    icon: '📧',
    instruction: `[전사/팀 공유용 이메일 공지문 지침]
- 회의에 불참한 팀원도 1분 안에 상황을 파악할 수 있도록 친절하고 명확한 톤앤매너로 작성하세요.
- 출력 구조:
  - 제목: [공지/공유] 회의 주요 결과 안내
  - 본문 서두 인사 및 회의 개요
  - 핵심 결정 사항 요약 (불릿 포인트 3~4개)
  - 부서별 협조 요청 사항
  - 문의처 및 추가 문서 링크 안내`
  },
  custom: {
    name: '사용자 맞춤 지침',
    icon: '🎯',
    instruction: `[사용자 지정 맞춤 지침]
- 사용자가 아래 추가 맞춤 지침에 입력한 규칙과 구조에 맞추어 전문적으로 회의록을 정리하세요.`
  }
};

// DOM Elements Cache
const el = {
  // Sidebar
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
  sidebarExpandBtn: document.getElementById('sidebarExpandBtn'),
  newMeetingBtn: document.getElementById('newMeetingBtn'),
  meetingSearchInput: document.getElementById('meetingSearchInput'),
  meetingList: document.getElementById('meetingList'),
  meetingCountBadge: document.getElementById('meetingCountBadge'),
  openUserGuideBtn: document.getElementById('openUserGuideBtn'),
  topUserGuideBtn: document.getElementById('topUserGuideBtn'),
  userGuideModal: document.getElementById('userGuideModal'),
  closeUserGuideModalBtn: document.getElementById('closeUserGuideModalBtn'),
  openDeployGuideBtn: document.getElementById('openDeployGuideBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),

  // Top Bar & Controls
  breadcrumbTitle: document.getElementById('breadcrumbTitle'),
  saveStatusPill: document.getElementById('saveStatusPill'),
  copyCleanTranscriptBtn: document.getElementById('copyCleanTranscriptBtn'),
  exportMarkdownBtn: document.getElementById('exportMarkdownBtn'),
  transcribeTriggerBtn: document.getElementById('transcribeTriggerBtn'),
  transcribeDropdown: document.getElementById('transcribeDropdown'),

  // Top Bar Dropdown Items
  optMicRecord: document.getElementById('optMicRecord'),
  optYoutubeUrl: document.getElementById('optYoutubeUrl'),
  optLoopbackRecord: document.getElementById('optLoopbackRecord'),
  optUploadAudio: document.getElementById('optUploadAudio'),
  optSampleDemo: document.getElementById('optSampleDemo'),
  audioFileInput: document.getElementById('audioFileInput'),

  // YouTube Direct Modal
  youtubeUrlModal: document.getElementById('youtubeUrlModal'),
  closeYoutubeModalBtn: document.getElementById('closeYoutubeModalBtn'),
  cancelYoutubeModalBtn: document.getElementById('cancelYoutubeModalBtn'),
  startYoutubeTranscribeBtn: document.getElementById('startYoutubeTranscribeBtn'),
  youtubeUrlInput: document.getElementById('youtubeUrlInput'),

  // Document Properties
  docIconBadge: document.getElementById('docIconBadge'),
  docTitleInput: document.getElementById('docTitleInput'),
  docDateInput: document.getElementById('docDateInput'),
  docAttendeesInput: document.getElementById('docAttendeesInput'),
  docCategoryInput: document.getElementById('docCategoryInput'),
  audioStatusIndicator: document.getElementById('audioStatusIndicator'),
  audioDurationBadge: document.getElementById('audioDurationBadge'),

  // Recording Banner
  recordingBanner: document.getElementById('recordingBanner'),
  recStatusText: document.getElementById('recStatusText'),
  recordingTimer: document.getElementById('recordingTimer'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  pauseRecBtn: document.getElementById('pauseRecBtn'),
  stopRecBtn: document.getElementById('stopRecBtn'),
  cancelRecBtn: document.getElementById('cancelRecBtn'),

  // Tabs
  tabBtns: document.querySelectorAll('.doc-tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  dialogueCountBadge: document.getElementById('dialogueCountBadge'),
  aiStatusBadge: document.getElementById('aiStatusBadge'),

  // Tab 1: Memo
  agendaInput: document.getElementById('agendaInput'),
  meetingNotesInput: document.getElementById('meetingNotesInput'),

  // Tab 2: Transcription & Speaker Mapping
  detectedSpeakerCountPill: document.getElementById('detectedSpeakerCountPill'),
  speakerCapSelect: document.getElementById('speakerCapSelect'),
  btnRefineDiarization: document.getElementById('btnRefineDiarization'),
  speakerInputsGrid: document.getElementById('speakerInputsGrid'),
  transcriptKeywordFilter: document.getElementById('transcriptKeywordFilter'),
  copyMappedTranscriptBtn: document.getElementById('copyMappedTranscriptBtn'),
  audioPlayerDock: document.getElementById('audioPlayerDock'),
  playerPlayBtn: document.getElementById('playerPlayBtn'),
  playIcon: document.getElementById('playIcon'),
  pauseIcon: document.getElementById('pauseIcon'),
  playerCurrentTime: document.getElementById('playerCurrentTime'),
  playerDuration: document.getElementById('playerDuration'),
  playerSeekbar: document.getElementById('playerSeekbar'),
  downloadAudioLink: document.getElementById('downloadAudioLink'),
  coreAudioElement: document.getElementById('coreAudioElement'),
  dialogueFeed: document.getElementById('dialogueFeed'),
  feedEmptyState: document.getElementById('feedEmptyState'),

  // Tab 3: AI Prompt Studio
  presetsGrid: document.getElementById('presetsGrid'),
  customInstructionInput: document.getElementById('customInstructionInput'),
  copyPromptPackageBtn: document.getElementById('copyPromptPackageBtn'),
  runInAppSummaryBtn: document.getElementById('runInAppSummaryBtn'),
  promptTokenEstimate: document.getElementById('promptTokenEstimate'),
  promptPreviewCode: document.getElementById('promptPreviewCode'),
  aiResultCard: document.getElementById('aiResultCard'),
  aiResultBody: document.getElementById('aiResultBody'),
  copyResultBtn: document.getElementById('copyResultBtn'),

  // Modals
  loopbackGuideModal: document.getElementById('loopbackGuideModal'),
  closeLoopbackModalBtn: document.getElementById('closeLoopbackModalBtn'),
  cancelLoopbackBtn: document.getElementById('cancelLoopbackBtn'),
  startLoopbackNowBtn: document.getElementById('startLoopbackNowBtn'),

  deployGuideModal: document.getElementById('deployGuideModal'),
  closeDeployModalBtn: document.getElementById('closeDeployModalBtn'),

  settingsModal: document.getElementById('settingsModal'),
  closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
  settingSttEngine: document.getElementById('settingSttEngine'),
  settingSummaryProvider: document.getElementById('settingSummaryProvider'),
  settingApiKey: document.getElementById('settingApiKey'),
  settingGroqKey: document.getElementById('settingGroqKey'),
  settingBackendUrl: document.getElementById('settingBackendUrl'),
  apiKeyFormGroup: document.getElementById('apiKeyFormGroup'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),

  // Toast
  toast: document.getElementById('toast')
};

// Utilities
function showToast(message, duration = 3000) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), duration);
}

function formatSeconds(secs) {
  if (isNaN(secs) || secs < 0) secs = 0;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

let saveDebounceTimer = null;
function triggerAutoSave() {
  el.saveStatusPill.innerHTML = '<span class="save-dot" style="background:#f59e0b;"></span> 저장 중...';
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await saveCurrentMeetingToServer();
      el.saveStatusPill.innerHTML = '<span class="save-dot"></span> 자동 저장됨';
    } catch (e) {
      el.saveStatusPill.innerHTML = '<span class="save-dot" style="background:#ef4444;"></span> 저장 오류';
    }
  }, 800);
}

// --------------------------------------------------------------------------
// Core Initializer
// --------------------------------------------------------------------------
async function initApp() {
  initEventListeners();
  initAudioPlayer();
  await loadMeetingList();

  // If there are meetings, open the latest one; otherwise create a new one
  const meetings = await StorageAdapter.listMeetings();
  if (meetings && meetings.length > 0) {
    await openMeeting(meetings[0].id);
  } else {
    resetToNewMeeting();
  }
}

// --------------------------------------------------------------------------
// Event Listeners
// --------------------------------------------------------------------------
function initEventListeners() {
  // Sidebar Toggles (Desktop & Mobile Drawer)
  function openSidebar() {
    el.sidebar.classList.remove('collapsed');
    el.sidebar.classList.add('open');
    el.sidebarBackdrop?.classList.add('active');
  }
  function closeSidebar() {
    el.sidebar.classList.add('collapsed');
    el.sidebar.classList.remove('open');
    el.sidebarBackdrop?.classList.remove('active');
  }

  el.sidebarToggleBtn?.addEventListener('click', closeSidebar);
  el.sidebarExpandBtn?.addEventListener('click', openSidebar);
  el.sidebarBackdrop?.addEventListener('click', closeSidebar);

  // New Meeting
  el.newMeetingBtn?.addEventListener('click', () => {
    resetToNewMeeting();
    showToast('새 회의록이 생성되었습니다.');
  });

  // Search Filter
  el.meetingSearchInput?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.meeting-item').forEach(item => {
      const title = item.querySelector('.meeting-item-title').textContent.toLowerCase();
      item.style.display = title.includes(q) ? 'flex' : 'none';
    });
  });

  // Document Property Inputs -> Auto-Save
  el.docTitleInput?.addEventListener('input', (e) => {
    state.title = e.target.value || '제목 없는 회의';
    el.breadcrumbTitle.textContent = state.title;
    triggerAutoSave();
  });
  el.docDateInput?.addEventListener('change', (e) => {
    state.date = e.target.value;
    triggerAutoSave();
  });
  el.docAttendeesInput?.addEventListener('input', (e) => {
    state.attendees = e.target.value;
    triggerAutoSave();
  });
  el.docCategoryInput?.addEventListener('input', (e) => {
    state.category = e.target.value;
    triggerAutoSave();
  });
  el.agendaInput?.addEventListener('input', (e) => {
    state.agenda = e.target.value;
    triggerAutoSave();
  });
  el.meetingNotesInput?.addEventListener('input', (e) => {
    state.notes = e.target.value;
    triggerAutoSave();
  });

  // Tabs Switching
  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.dataset.tab;
      el.tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      el.tabContents.forEach(c => c.classList.toggle('active', c.id === `tab-${tabKey}`));
      if (tabKey === 'ai-prompt-studio') {
        compilePromptPackage();
      }
    });
  });

  // Transcribe Dropdown Toggle
  el.transcribeTriggerBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.toggle('show');
  });
  document.addEventListener('click', () => {
    el.transcribeDropdown?.classList.remove('show');
  });

  // Dropdown Options
  el.optMicRecord?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.remove('show');
    startRecording('mic');
  });
  el.optYoutubeUrl?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.remove('show');
    el.youtubeUrlModal.style.display = 'flex';
  });
  el.optLoopbackRecord?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.remove('show');
    el.loopbackGuideModal.style.display = 'flex';
  });
  el.optUploadAudio?.addEventListener('click', (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.remove('show');
    el.audioFileInput.click();
  });
  el.optSampleDemo?.addEventListener('click', async (e) => {
    e.stopPropagation();
    el.transcribeDropdown.classList.remove('show');
    await loadSampleDemo();
  });

  // YouTube Direct Modal
  el.closeYoutubeModalBtn?.addEventListener('click', () => el.youtubeUrlModal.style.display = 'none');
  el.cancelYoutubeModalBtn?.addEventListener('click', () => el.youtubeUrlModal.style.display = 'none');
  el.startYoutubeTranscribeBtn?.addEventListener('click', handleYoutubeDirectTranscribe);

  // Large File Upload Handler
  el.audioFileInput?.addEventListener('change', handleAudioFileUpload);

  // Recording Banner Action Buttons
  el.pauseRecBtn?.addEventListener('click', togglePauseRecording);
  el.stopRecBtn?.addEventListener('click', finishRecordingAndTranscribe);
  el.cancelRecBtn?.addEventListener('click', cancelRecording);

  // Loopback Modal
  el.closeLoopbackModalBtn?.addEventListener('click', () => el.loopbackGuideModal.style.display = 'none');
  el.cancelLoopbackBtn?.addEventListener('click', () => el.loopbackGuideModal.style.display = 'none');
  el.startLoopbackNowBtn?.addEventListener('click', () => {
    el.loopbackGuideModal.style.display = 'none';
    startRecording('loopback');
  });

  // User Guide Modal
  const openUserGuide = () => { if (el.userGuideModal) el.userGuideModal.style.display = 'flex'; };
  const closeUserGuide = () => { if (el.userGuideModal) el.userGuideModal.style.display = 'none'; };
  el.openUserGuideBtn?.addEventListener('click', openUserGuide);
  el.topUserGuideBtn?.addEventListener('click', openUserGuide);
  el.closeUserGuideModalBtn?.addEventListener('click', closeUserGuide);
  el.userGuideModal?.addEventListener('click', (e) => {
    if (e.target === el.userGuideModal) closeUserGuide();
  });

  // Deploy Guide Modal
  el.openDeployGuideBtn?.addEventListener('click', () => el.deployGuideModal.style.display = 'flex');
  el.closeDeployModalBtn?.addEventListener('click', () => el.deployGuideModal.style.display = 'none');

  // Settings Modal
  el.openSettingsBtn?.addEventListener('click', () => {
    el.settingSttEngine.value = state.settings.sttEngine;
    el.settingSummaryProvider.value = state.settings.summaryProvider;
    el.settingApiKey.value = state.settings.apiKey;
    if (el.settingGroqKey) el.settingGroqKey.value = state.settings.groqKey || '';
    if (el.settingBackendUrl) el.settingBackendUrl.value = state.settings.backendUrl || '';
    el.settingsModal.style.display = 'flex';
  });
  el.closeSettingsModalBtn?.addEventListener('click', () => el.settingsModal.style.display = 'none');
  el.saveSettingsBtn?.addEventListener('click', () => {
    state.settings.sttEngine = el.settingSttEngine.value;
    state.settings.summaryProvider = el.settingSummaryProvider.value;
    state.settings.apiKey = el.settingApiKey.value.trim();
    if (el.settingGroqKey) state.settings.groqKey = el.settingGroqKey.value.trim();
    if (el.settingBackendUrl) state.settings.backendUrl = el.settingBackendUrl.value.trim();

    localStorage.setItem('meetflow_stt_engine', state.settings.sttEngine);
    localStorage.setItem('meetflow_summary_provider', state.settings.summaryProvider);
    localStorage.setItem('meetflow_apikey', state.settings.apiKey);
    if (el.settingGroqKey) localStorage.setItem('meetflow_groq_key', state.settings.groqKey);
    if (el.settingBackendUrl) localStorage.setItem('meetflow_backend_url', state.settings.backendUrl);

    el.settingsModal.style.display = 'none';
    showToast('설정이 브라우저에 안전하게 저장되었습니다.');
  });

  // Speaker Cap Selector (화자 수 고정: 무한정 늘어남 방지)
  if (el.speakerCapSelect) {
    el.speakerCapSelect.value = state.targetSpeakerCount || '3';
    el.speakerCapSelect.addEventListener('change', (e) => {
      state.targetSpeakerCount = e.target.value;
      localStorage.setItem('meetflow_speaker_cap', state.targetSpeakerCount);
      renderSpeakerMappingBar();
      renderDialogueFeed();
      compilePromptPackage();
      showToast(`화자 수가 '${e.target.options[e.target.selectedIndex].text}'로 고정되었습니다.`);
    });
  }

  // Keyword Filter for Dialogue
  el.transcriptKeywordFilter?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.dialogue-bubble').forEach(bubble => {
      const text = bubble.querySelector('.dialogue-text').textContent.toLowerCase();
      const speaker = bubble.querySelector('.dialogue-speaker-name').textContent.toLowerCase();
      bubble.style.display = (!q || text.includes(q) || speaker.includes(q)) ? 'flex' : 'none';
    });
  });

  // AI Diarization Refine Button
  el.btnRefineDiarization?.addEventListener('click', handleRefineDiarization);

  // Presets Grid Selection
  document.querySelectorAll('.preset-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.selectedPreset = card.dataset.preset;
      compilePromptPackage();
      triggerAutoSave();
    });
  });

  // Custom Instruction Change
  el.customInstructionInput?.addEventListener('input', (e) => {
    state.customInstruction = e.target.value;
    compilePromptPackage();
    triggerAutoSave();
  });

  // Copy Buttons
  el.copyCleanTranscriptBtn?.addEventListener('click', copyCleanTranscriptToClipboard);
  el.copyMappedTranscriptBtn?.addEventListener('click', copyCleanTranscriptToClipboard);
  el.copyPromptPackageBtn?.addEventListener('click', copyPromptPackageToClipboard);
  el.copyResultBtn?.addEventListener('click', copyAiResultToClipboard);
  el.exportMarkdownBtn?.addEventListener('click', exportMarkdownFile);

  // In-App Summary Run
  el.runInAppSummaryBtn?.addEventListener('click', runInAppSummary);

  // Playback Speed Controls
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      el.coreAudioElement.playbackRate = parseFloat(btn.dataset.speed);
    });
  });
}

// --------------------------------------------------------------------------
// Audio Player Logic
// --------------------------------------------------------------------------
function initAudioPlayer() {
  const audio = el.coreAudioElement;

  el.playerPlayBtn?.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    el.playIcon.style.display = 'none';
    el.pauseIcon.style.display = 'block';
  });

  audio.addEventListener('pause', () => {
    el.playIcon.style.display = 'block';
    el.pauseIcon.style.display = 'none';
  });

  audio.addEventListener('timeupdate', () => {
    if (!isNaN(audio.duration) && audio.duration > 0) {
      el.playerSeekbar.value = (audio.currentTime / audio.duration) * 100;
      el.playerCurrentTime.textContent = formatSeconds(audio.currentTime);
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    el.playerDuration.textContent = formatSeconds(audio.duration);
    el.audioDurationBadge.textContent = formatSeconds(audio.duration);
    state.duration = Math.floor(audio.duration);
  });

  el.playerSeekbar?.addEventListener('input', (e) => {
    if (!isNaN(audio.duration)) {
      audio.currentTime = (e.target.value / 100) * audio.duration;
    }
  });
}

function setAudioSource(url) {
  state.audioUrl = url;
  if (url) {
    el.coreAudioElement.src = url;
    el.audioPlayerDock.style.display = 'flex';
    el.audioStatusIndicator.textContent = '오디오 준비됨';
    el.audioStatusIndicator.classList.add('ready');
    el.downloadAudioLink.href = url;
  } else {
    el.coreAudioElement.src = '';
    el.audioPlayerDock.style.display = 'none';
    el.audioStatusIndicator.textContent = '오디오 없음';
    el.audioStatusIndicator.classList.remove('ready');
    el.audioDurationBadge.textContent = '00:00';
  }
}

// --------------------------------------------------------------------------
// Speaker Diarization & Real-Time Dynamic Name Mapping (사용자의 핵심 요구사항)
// --------------------------------------------------------------------------
function getAllKnownSpeakers() {
  const speakersSet = new Set();
  state.dialogues.forEach(d => {
    const spk = d.originalSpeaker || d.speaker;
    if (spk) speakersSet.add(spk);
  });
  Object.keys(state.speakerMap).forEach(spk => {
    if (spk) speakersSet.add(spk);
  });

  if (speakersSet.size === 0 && state.isRecording) {
    speakersSet.add('화자 1');
    speakersSet.add('화자 2');
  }

  return Array.from(speakersSet).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
    const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
    return numA - numB;
  });
}

function renderSpeakerMappingBar() {
  const grid = el.speakerInputsGrid;
  grid.innerHTML = '';

  const speakers = getAllKnownSpeakers();

  if (speakers.length === 0) {
    grid.innerHTML = `
      <div class="speaker-empty-placeholder">
        아직 전사된 대화가 없습니다. 상단의 [받아쓰기 시작하기]를 통해 회의 음성을 등록하세요.
      </div>`;
    el.detectedSpeakerCountPill.textContent = '감지된 화자: 0명';
    return;
  }

  el.detectedSpeakerCountPill.textContent = `감지된 화자: 총 ${speakers.length}명 (${speakers.join(', ')})`;

  // Render an input card for each detected speaker
  speakers.forEach((spk, idx) => {
    const card = document.createElement('div');
    card.className = 'speaker-card-item';

    const currentName = state.speakerMap[spk] || '';
    const numMatch = spk.match(/\d+/);
    const colorIdx = numMatch ? (((parseInt(numMatch[0], 10) - 1) % 6) + 1) : 1;

    card.innerHTML = `
      <span class="speaker-avatar avatar-color-${colorIdx}" style="width:24px;height:24px;font-size:10px;">${spk.replace(/\D/g, '') || idx+1}</span>
      <span class="speaker-id-tag">${spk}</span>
      <span class="speaker-arrow">➔</span>
      <input type="text" class="speaker-name-input" data-speaker="${spk}" value="${escapeHtml(currentName)}" placeholder="실명 입력 (예: ${idx === 0 ? '허경환' : idx === 1 ? '양상국' : '성현주'})">
      <button class="speaker-del-btn" title="${spk} 삭제" data-speaker="${spk}">✕</button>
    `;

    const delBtn = card.querySelector('.speaker-del-btn');
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSpeaker(spk);
    });

    const input = card.querySelector('.speaker-name-input');
    input.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      state.speakerMap[spk] = val;

      // Real-time live update of all dialogue bubbles for this speaker!
      updateDialogueSpeakerNamesInDom(spk, val);
      compilePromptPackage();
      triggerAutoSave();
    });

    grid.appendChild(card);
  });

  // Add '+ 화자 추가' Button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-speaker';
  addBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    화자 추가
  `;
  addBtn.title = '새로운 화자 레이블을 추가합니다';
  addBtn.addEventListener('click', () => {
    let maxNum = 0;
    speakers.forEach(s => {
      const m = s.match(/\d+/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[0], 10));
    });
    const nextSpk = `화자 ${maxNum + 1}`;
    state.speakerMap[nextSpk] = '';
    renderSpeakerMappingBar();
    renderDialogueFeed();
    showToast(`➕ '${nextSpk}'가 추가되었습니다. 실명을 입력하세요.`);
  });
  grid.appendChild(addBtn);

  // Add '미사용 화자 정리' Button
  const cleanBtn = document.createElement('button');
  cleanBtn.className = 'btn-clean-speakers';
  cleanBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
    미사용 화자 정리
  `;
  cleanBtn.title = '대화에 발언이 없는 잉여 화자를 일괄 삭제합니다';
  cleanBtn.addEventListener('click', cleanUnusedSpeakers);
  grid.appendChild(cleanBtn);
}

function deleteSpeaker(targetSpk) {
  const remaining = getAllKnownSpeakers().filter(s => s !== targetSpk);
  const fallbackSpk = remaining[0] || '화자 1';

  let count = 0;
  state.dialogues.forEach(d => {
    if (d.originalSpeaker === targetSpk || d.speaker === targetSpk) {
      d.originalSpeaker = fallbackSpk;
      d.speaker = fallbackSpk;
      count++;
    }
  });

  delete state.speakerMap[targetSpk];
  renderSpeakerMappingBar();
  renderDialogueFeed();
  compilePromptPackage();
  triggerAutoSave();
  showToast(`🗑️ '${targetSpk}'이(가) 삭제되었습니다${count > 0 ? ` (${count}개 발언이 ${fallbackSpk}로 통합됨)` : ''}.`);
}

function cleanUnusedSpeakers() {
  const usedSet = new Set();
  state.dialogues.forEach(d => {
    const spk = d.originalSpeaker || d.speaker;
    if (spk) usedSet.add(spk);
  });

  if (usedSet.size === 0) {
    showToast('정리할 대화 기록이 없습니다.');
    return;
  }

  let removedCount = 0;
  Object.keys(state.speakerMap).forEach(spk => {
    if (!usedSet.has(spk)) {
      delete state.speakerMap[spk];
      removedCount++;
    }
  });

  renderSpeakerMappingBar();
  renderDialogueFeed();
  compilePromptPackage();
  triggerAutoSave();
  showToast(removedCount > 0 ? `🧹 미사용 화자 ${removedCount}명이 정리되었습니다!` : '모든 화자가 실제 대화에 사용 중입니다.');
}

function updateDialogueSpeakerNamesInDom(originalSpeaker, newName) {
  const displayName = newName || originalSpeaker;
  document.querySelectorAll(`.dialogue-bubble[data-original-speaker="${originalSpeaker}"]`).forEach(bubble => {
    const nameEl = bubble.querySelector('.dialogue-speaker-name');
    if (nameEl) nameEl.textContent = displayName;
    const avatarEl = bubble.querySelector('.speaker-avatar');
    if (avatarEl) avatarEl.textContent = displayName.charAt(0);
  });
}

function getSpeakerDisplayName(originalSpeaker) {
  return state.speakerMap[originalSpeaker] || originalSpeaker;
}

// --------------------------------------------------------------------------
// Dialogue Stream Feed Rendering
// --------------------------------------------------------------------------
function renderDialogueFeed() {
  const feed = el.dialogueFeed;
  feed.innerHTML = '';

  if (!state.dialogues || state.dialogues.length === 0) {
    feed.appendChild(el.feedEmptyState);
    el.dialogueCountBadge.textContent = '0';
    return;
  }

  el.dialogueCountBadge.textContent = state.dialogues.length.toString();
  const allSpeakers = getAllKnownSpeakers();

  state.dialogues.forEach((d, idx) => {
    const origSpeaker = d.originalSpeaker || d.speaker || '화자 1';
    const displayName = getSpeakerDisplayName(origSpeaker);

    // Color index from speaker number or hash
    let colorIdx = 1;
    const numMatch = origSpeaker.match(/\d+/);
    if (numMatch) {
      colorIdx = ((parseInt(numMatch[0], 10) - 1) % 6) + 1;
    }

    const bubble = document.createElement('div');
    bubble.className = 'dialogue-bubble';
    bubble.dataset.originalSpeaker = origSpeaker;
    bubble.dataset.index = idx;

    const timeStr = d.time || formatSeconds(d.start_seconds || 0);

    const speakerOptionsHtml = allSpeakers.map(s => {
      const sName = state.speakerMap[s] || s;
      const isSel = s === origSpeaker ? 'selected' : '';
      return `<option value="${escapeHtml(s)}" ${isSel}>${escapeHtml(sName)}</option>`;
    }).join('');

    bubble.innerHTML = `
      <div class="speaker-avatar avatar-color-${colorIdx}">${escapeHtml(displayName.charAt(0))}</div>
      <div class="dialogue-body">
        <div class="dialogue-header-line">
          <span class="dialogue-speaker-name">${escapeHtml(displayName)}</span>
          <select class="speaker-select-pill" title="이 발언의 화자 변경">
            ${speakerOptionsHtml}
          </select>
          <button class="btn-bubble-action btn-split-bubble" data-index="${idx}" title="이 발언을 다음 문맥에서 2개로 분할">✂️ 분할</button>
          ${idx > 0 ? `<button class="btn-bubble-action btn-merge-bubble" data-index="${idx}" title="이 발언을 이전 발언과 하나로 합치기">🔗 병합</button>` : ''}
          <span class="dialogue-time-tag" title="클릭하여 해당 시점으로 이동">[${timeStr}]</span>
        </div>
        <div class="dialogue-text" contenteditable="true">${escapeHtml(d.text)}</div>
      </div>
    `;

    // Dropdown to change speaker for this dialogue
    const sel = bubble.querySelector('.speaker-select-pill');
    sel.addEventListener('change', (e) => {
      d.originalSpeaker = e.target.value;
      d.speaker = e.target.value;
      renderSpeakerMappingBar();
      renderDialogueFeed();
      compilePromptPackage();
      triggerAutoSave();
    });

    // Split bubble into 2 turns
    const splitBtn = bubble.querySelector('.btn-split-bubble');
    splitBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      splitDialogueBubble(idx);
    });

    // Merge bubble with preceding bubble
    const mergeBtn = bubble.querySelector('.btn-merge-bubble');
    mergeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      mergeDialogueBubble(idx);
    });

    // Click timestamp to seek audio
    const timeTag = bubble.querySelector('.dialogue-time-tag');
    timeTag.addEventListener('click', () => {
      const secs = d.start_seconds !== undefined ? d.start_seconds : parseTimeToSeconds(timeStr);
      el.coreAudioElement.currentTime = secs;
      el.coreAudioElement.play();
    });

    // Contenteditable auto-save
    const textEl = bubble.querySelector('.dialogue-text');
    textEl.addEventListener('blur', () => {
      d.text = textEl.textContent.trim();
      compilePromptPackage();
      triggerAutoSave();
    });

    feed.appendChild(bubble);
  });
}

function splitDialogueBubble(idx) {
  const d = state.dialogues[idx];
  if (!d || !d.text) return;

  const text = d.text.trim();
  const match = text.match(/(?<=[.?!])\s+/);
  if (!match) {
    const words = text.split(' ');
    if (words.length <= 1) {
      showToast('분할할 문맥이 너무 짧습니다.');
      return;
    }
    const mid = Math.ceil(words.length / 2);
    applySplit(words.slice(0, mid).join(' '), words.slice(mid).join(' '));
    return;
  }

  const splitIdx = match.index + match[0].length;
  applySplit(text.substring(0, match.index + 1).trim(), text.substring(splitIdx).trim());

  function applySplit(p1, p2) {
    const curSpk = d.originalSpeaker || '화자 1';
    const num = parseInt(curSpk.replace(/\D/g, '') || '1', 10);
    const maxSpk = state.targetSpeakerCount === 'auto' ? 3 : parseInt(state.targetSpeakerCount || '3', 10);
    const nextSpk = `화자 ${(num % maxSpk) + 1}`;

    const dur = (d.end_seconds || (d.start_seconds + 3)) - d.start_seconds;
    const midTime = d.start_seconds + (dur / 2);

    d.text = p1;
    d.end_seconds = midTime;

    const newDiag = {
      time: formatSeconds(midTime),
      start_seconds: midTime,
      end_seconds: midTime + (dur / 2),
      speaker: nextSpk,
      originalSpeaker: nextSpk,
      text: p2
    };

    state.dialogues.splice(idx + 1, 0, newDiag);
    renderSpeakerMappingBar();
    renderDialogueFeed();
    compilePromptPackage();
    triggerAutoSave();
    showToast(`✂️ 발언이 분할되어 '${nextSpk}'에 할당되었습니다.`);
  }
}

function mergeDialogueBubble(idx) {
  if (idx <= 0 || !state.dialogues[idx]) return;
  const prev = state.dialogues[idx - 1];
  const curr = state.dialogues[idx];

  prev.text = mergeContinuousText(prev.text, curr.text);
  prev.end_seconds = Math.max(prev.end_seconds || 0, curr.end_seconds || 0);

  state.dialogues.splice(idx, 1);
  renderSpeakerMappingBar();
  renderDialogueFeed();
  compilePromptPackage();
  triggerAutoSave();
  showToast(`🔗 이전 발언과 성공적으로 합쳐졌습니다.`);
}

async function handleRefineDiarization() {
  if (!state.dialogues || state.dialogues.length === 0) {
    showToast('교정할 대화 기록이 없습니다.');
    return;
  }

  showToast('✨ 문맥, 호칭, 질문-답변을 정밀 분석하여 화자를 재배치 중입니다...');
  if (el.btnRefineDiarization) {
    el.btnRefineDiarization.disabled = true;
    el.btnRefineDiarization.textContent = '⏳ 화자 분리 교정 중...';
  }

  try {
    const numSpeakersParam = state.targetSpeakerCount && state.targetSpeakerCount !== 'auto'
      ? parseInt(state.targetSpeakerCount, 10)
      : 3;

    let refinedDialogues = null;

    if (await StorageAdapter.hasBackend()) {
      try {
        const res = await fetch('/api/refine-diarization', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dialogues: state.dialogues,
            numSpeakers: numSpeakersParam
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data.dialogues) refinedDialogues = data.dialogues;
        }
      } catch (_) {}
    }

    // Client-side rule engine fallback for GitHub Pages
    if (!refinedDialogues) {
      refinedDialogues = [];
      let currentSpkNum = 1;
      for (let i = 0; i < state.dialogues.length; i++) {
        const d = state.dialogues[i];
        const prev = i > 0 ? state.dialogues[i - 1] : null;

        if (prev) {
          const prevText = (prev.text || '').trim();
          const curText = (d.text || '').trim();
          const timeGap = (d.start_seconds || 0) - (prev.end_seconds || 0);

          const isQuestionTurn = /[?？]$/.test(prevText);
          const isResponseTurn = /^(네|아니|오빠|맞아|그래|근데|글쎄|저기|그렇|아\s|어\s|나도)/.test(curText);
          const isSentenceEnd = /[.!?]$/.test(prevText);
          const isPitchJump = (d.pitch && prev.pitch) ? Math.abs(d.pitch - prev.pitch) > 35 : false;

          if (isQuestionTurn || isResponseTurn || isPitchJump || (isSentenceEnd && timeGap > 0.6) || timeGap > 1.2) {
            currentSpkNum = (currentSpkNum % numSpeakersParam) + 1;
          }
        }

        refinedDialogues.push({
          ...d,
          speaker: `화자 ${currentSpkNum}`,
          originalSpeaker: `화자 ${currentSpkNum}`
        });
      }
    }

    state.dialogues = refinedDialogues;
    renderSpeakerMappingBar();
    renderDialogueFeed();
    compilePromptPackage();
    triggerAutoSave();
    showToast(`🎉 화자 분리 교정 완료! 대화 턴에 맞게 화자가 정상 재배치되었습니다.`);
  } catch (err) {
    console.error('Refine diarization error:', err);
    showToast(`화자 분리 교정 오류: ${err.message}`);
  } finally {
    if (el.btnRefineDiarization) {
      el.btnRefineDiarization.disabled = false;
      el.btnRefineDiarization.textContent = '✨ AI 화자 분리 교정';
    }
  }
}

// --------------------------------------------------------------------------
// Prompt Package Compiler (사용자의 두번째 핵심 요구사항: 완성형 프롬프트 패키지)
// --------------------------------------------------------------------------
function compilePromptPackage() {
  const presetKey = state.selectedPreset || 'executive';
  const preset = PRESETS[presetKey] || PRESETS.executive;

  // Build clean mapped transcript
  let mappedTranscriptText = '';
  if (state.dialogues && state.dialogues.length > 0) {
    mappedTranscriptText = state.dialogues.map(d => {
      const orig = d.originalSpeaker || d.speaker;
      const speakerName = getSpeakerDisplayName(orig);
      const timeStr = d.time || formatSeconds(d.start_seconds || 0);
      return `[${timeStr}] ${speakerName}: ${d.text}`;
    }).join('\n');
  } else {
    mappedTranscriptText = '(전사된 대화 기록이 아직 없습니다)';
  }

  const promptPackage = `### [시스템 역할 지침]
당신은 최고 수준의 비즈니스 회의 분석가이자 전문 테크니컬 라이터입니다.
제공된 실제 회의 대화 전사본(Speaker-mapped Transcript)과 회의 안건 메모를 면밀히 분석하여, 아래 요청된 [정리 방향 지침]에 따라 최고 수준의 구조화된 보고서를 작성해 주세요.

---

### [기본 회의 정보]
- 회의명: ${state.title || '새 회의록'}
- 일시: ${state.date || ''}
- 참석자: ${state.attendees || '미지정'}
- 분류: ${state.category || '내 회의'}
- 사전 안건:
${state.agenda || '등록된 안건 없음'}

---

### [정리 방향 지침: ${preset.name}]
${preset.instruction}
${state.customInstruction ? `\n[추가 맞춤 지침]:\n${state.customInstruction}` : ''}

---

### [회의 실제 대화 전사본 (화자 실명 매핑 완료)]
\`\`\`text
${mappedTranscriptText}
\`\`\`

---
위 지침과 전사본을 바탕으로 지금 즉시 완성도 높은 전문 회의록을 생성해 주세요.`;

  el.promptPreviewCode.textContent = promptPackage;

  // Estimate tokens (roughly 1 token per 2.5 characters in Korean)
  const tokenEst = Math.round(promptPackage.length / 2.5);
  el.promptTokenEstimate.textContent = `약 ${tokenEst.toLocaleString()} 토큰`;

  return promptPackage;
}

// --------------------------------------------------------------------------
// Copy Actions
// --------------------------------------------------------------------------
async function copyCleanTranscriptToClipboard() {
  if (!state.dialogues || state.dialogues.length === 0) {
    showToast('전사된 대화 기록이 없습니다.');
    return;
  }

  const text = state.dialogues.map(d => {
    const orig = d.originalSpeaker || d.speaker;
    const speakerName = getSpeakerDisplayName(orig);
    const timeStr = d.time || formatSeconds(d.start_seconds || 0);
    return `[${timeStr}] ${speakerName}: ${d.text}`;
  }).join('\n');

  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ 실명이 적용된 전사본 전체가 클립보드에 복사되었습니다!');
  } catch (err) {
    fallbackCopyText(text);
    showToast('✅ 전사본이 복사되었습니다.');
  }
}

async function copyPromptPackageToClipboard() {
  const prompt = compilePromptPackage();
  try {
    await navigator.clipboard.writeText(prompt);
    showToast('🤖 ChatGPT / Claude용 프롬프트 패키지가 복사되었습니다! 바로 붙여넣으세요.');
  } catch (err) {
    fallbackCopyText(prompt);
    showToast('🤖 프롬프트 패키지가 복사되었습니다.');
  }
}

async function copyAiResultToClipboard() {
  const text = el.aiResultBody.innerText;
  if (!text || text.includes('상단의 [내장 AI로 즉시 요약 실행]을 누르거나')) {
    showToast('생성된 요약 보고서가 없습니다.');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ AI 분석 보고서가 복사되었습니다!');
  } catch (err) {
    fallbackCopyText(text);
    showToast('✅ 보고서가 복사되었습니다.');
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function exportMarkdownFile() {
  const prompt = compilePromptPackage();
  const blob = new Blob([prompt], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.title || '회의록').replace(/[\/\\:*?"<>|]/g, '_')}_${state.date}.md`;
  a.click();
  showToast('💾 마크다운 문서가 다운로드되었습니다.');
}

// --------------------------------------------------------------------------
// In-App AI Summary Execution
// --------------------------------------------------------------------------
async function runInAppSummary() {
  if (!state.dialogues || state.dialogues.length === 0) {
    showToast('전사된 대화 내용이 없어 요약을 생성할 수 없습니다.');
    return;
  }

  el.runInAppSummaryBtn.disabled = true;
  el.runInAppSummaryBtn.innerHTML = '<span class="sparkle">⏳</span> AI 분석 중...';
  el.aiStatusBadge.textContent = '요약 중';
  el.aiResultBody.innerHTML = '<div class="result-empty-hint">⚡ 회의 전사본과 선택한 지침을 분석하여 전문 보고서를 생성 중입니다...</div>';

  try {
    let summaryMarkdown = '';

    // 1. Try local Node backend if running
    if (await StorageAdapter.hasBackend()) {
      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId: state.currentMeetingId,
            title: state.title,
            agenda: state.agenda,
            dialogues: state.dialogues,
            speakerMap: state.speakerMap,
            preset: state.selectedPreset,
            customInstruction: state.customInstruction,
            settings: state.settings
          })
        });
        const data = await res.json();
        if (data.summary) summaryMarkdown = data.summary;
      } catch (_) {}
    }

    // 2. Direct client-side AI fallback (GitHub Pages serverless)
    if (!summaryMarkdown) {
      const prompt = compilePromptPackage();

      // Check Gemini API
      const geminiKey = state.settings.apiKey;
      if (geminiKey && (geminiKey.startsWith('AIza') || state.settings.summaryProvider === 'gemini')) {
        try {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          if (gRes.ok) {
            const gData = await gRes.json();
            summaryMarkdown = gData.candidates?.[0]?.content?.parts?.[0]?.text;
          }
        } catch (_) {}
      }

      // Check Groq LLaMA
      if (!summaryMarkdown && state.settings.groqKey) {
        try {
          const qRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.settings.groqKey}`
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: prompt }]
            })
          });
          if (qRes.ok) {
            const qData = await qRes.json();
            summaryMarkdown = qData.choices?.[0]?.message?.content;
          }
        } catch (_) {}
      }

      // 3. Client-side Smart Heuristic Summarizer (0 cost, no keys needed)
      if (!summaryMarkdown) {
        summaryMarkdown = generateLocalSummaryClient(state.title, state.agenda, state.dialogues, state.speakerMap, state.selectedPreset);
      }
    }

    if (summaryMarkdown) {
      state.summary = summaryMarkdown;
      renderAiSummary(summaryMarkdown);
      el.aiStatusBadge.textContent = '완료';
      showToast('✨ AI 회의록 분석 보고서 생성이 완료되었습니다!');
      triggerAutoSave();
    } else {
      throw new Error('요약 생성에 실패했습니다.');
    }
  } catch (err) {
    el.aiResultBody.innerHTML = `<div class="result-empty-hint" style="color:#ef4444;">⚠️ 오류 발생: ${escapeHtml(err.message)}</div>`;
    showToast(`요약 생성 오류: ${err.message}`);
    el.aiStatusBadge.textContent = '실패';
  } finally {
    el.runInAppSummaryBtn.disabled = false;
    el.runInAppSummaryBtn.innerHTML = '<span class="sparkle">⚡</span> 내장 AI로 즉시 요약 실행';
  }
}

function generateLocalSummaryClient(title, agenda, dialogues, speakerMap, preset) {
  const sentences = (dialogues || []).map(d => d.text.trim()).filter(Boolean);

  let executiveSummary = '';
  if (sentences.length <= 3) {
    executiveSummary = sentences.join(' ') || '회의가 간략히 진행되었으며 세부 발화 내용이 자동으로 기록되었습니다.';
  } else {
    executiveSummary = `본 회의에서는 '${title || '새 회의'}'을(를) 주제로 참석자가 모여 주요 안건을 검토하고 구체적인 실행 방안 및 진행 상황을 집중 논의하였습니다. ` +
      sentences.slice(0, 3).join(' ');
  }

  const topicKeywords = ['논의', '진행', '개발', '일정', '문제', '개선', '고려', '결과', '검토', '기능', '테스트', '수집', '시스템', '운전', '화자'];
  const matchedPoints = sentences.filter(s => topicKeywords.some(k => s.includes(k)));
  const keyPoints = matchedPoints.length > 0 ? matchedPoints.slice(0, 4) : sentences.slice(0, 3);

  const decisionKeywords = ['결정', '하기로', '합의', '확정', '완료', '도입', '적용', '유지하기로', '해야 돼', '그래야', '하자'];
  const decisionLines = sentences.filter(s => decisionKeywords.some(k => s.includes(k)));
  const decisions = decisionLines.length > 0 ? decisionLines.slice(0, 3) : ['주요 안건에 대한 잠정 합의를 마쳤으며 차주 미팅에서 최종 확정하기로 함.'];

  let md = `## 📌 [브라우저 내장 AI] ${PRESETS[preset]?.name || '회의 핵심 요약'}\n\n`;
  md += `> **개요 요약**\n> ${executiveSummary}\n\n`;
  md += `### 💡 주요 논의 사항\n`;
  keyPoints.forEach(p => { md += `- ${p}\n`; });
  md += `\n### ⚖️ 의사결정 및 합의 사항\n`;
  decisions.forEach(d => { md += `- ${d}\n`; });
  md += `\n### 📋 실무 액션 아이템\n`;
  md += `- [ ] **${title || '회의'} 관련 후속 피드백 수렴 및 세부 태스크 착수** (@전체) [기한: 차주 회의 전]\n`;
  md += `- [ ] **회의 녹취록 및 요약 보고서 사내/팀원 공유** (@작성자) [기한: 오늘]\n\n`;
  md += `> 💡 *TIP: 상단의 [다른 AI용 프롬프트 패키지 복사] 버튼을 누르면 ChatGPT / Claude 등 외부 고급 AI에서도 동일하게 최상위 보고서를 생성할 수 있습니다.*`;

  return md;
}

function renderAiSummary(summary) {
  if (!summary) return;

  // Simple clean markdown-to-html renderer
  let html = summary
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\n\n/gim, '</p><p>')
    .replace(/\n/gim, '<br>');

  el.aiResultBody.innerHTML = `<div class="rendered-summary"><p>${html}</p></div>`;
}

// --------------------------------------------------------------------------
// Fresh Meeting State Preparation (사용자 요구: 새 녹음 시 이전 회의 내용 완벽 분리)
// --------------------------------------------------------------------------
function prepareFreshMeeting(titlePrefix = '새 회의록') {
  state.currentMeetingId = `meet_${Date.now()}`;
  state.title = titlePrefix;
  state.date = new Date().toISOString().split('T')[0];
  state.attendees = '';
  state.category = titlePrefix.includes('유튜브') ? '유튜브 전사' : '내 회의';
  state.agenda = '';
  state.notes = '';
  state.audioUrl = null;
  state.duration = 0;
  state.dialogues = [];
  state.speakerMap = {};
  state.selectedPreset = 'executive';
  state.customInstruction = '';
  state.summary = null;

  renderMeetingView();
  updateMeetingListActiveState();
}

// --------------------------------------------------------------------------
// Audio Recording & High-Performance 16kHz WAV Live Streaming STT
// (VAD 침묵 감지, 0.8초 오버랩, 문맥 initial_prompt 및 동일 화자 발언 자동 병합)
// --------------------------------------------------------------------------
let liveChunkTimer = null;
let isChunkTranscribing = false;
let silentSeconds = 0;
let silentWarned = false;
let pcmProcessorNode = null;
let pcmAccumulatedBuffers = [];
let recentRmsLevels = [];
let lastTranscribedSnippet = '';

function encodeWAV16k(samples, inputSampleRate) {
  const targetSampleRate = 16000;
  let resampled;
  if (inputSampleRate === targetSampleRate) {
    resampled = samples;
  } else {
    const ratio = inputSampleRate / targetSampleRate;
    const newLen = Math.round(samples.length / ratio);
    resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const origIdx = Math.floor(i * ratio);
      resampled[i] = samples[origIdx] || 0;
    }
  }

  const buffer = new ArrayBuffer(44 + resampled.length * 2);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + resampled.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetSampleRate, true); // 16000 Hz
  view.setUint32(28, targetSampleRate * 2, true); // byte rate (16000 * 2)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16 bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, resampled.length * 2, true);

  let pcmOffset = 44;
  for (let i = 0; i < resampled.length; i++, pcmOffset += 2) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(pcmOffset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

// Seamlessly merge continuous speech across chunk boundaries, removing duplicate words and ellipses
function mergeContinuousText(prev, next) {
  if (!prev) return next;
  if (!next) return prev;

  prev = prev.trim();
  next = next.trim();

  // Deduplicate overlapping words on boundary (1 to 4 words)
  const prevWords = prev.split(/\s+/);
  const nextWords = next.split(/\s+/);

  let overlapCount = 0;
  for (let n = Math.min(prevWords.length, nextWords.length, 4); n >= 1; n--) {
    const prevTail = prevWords.slice(-n).join(' ').toLowerCase().replace(/[^\w가-힣]/g, '');
    const nextHead = nextWords.slice(0, n).join(' ').toLowerCase().replace(/[^\w가-힣]/g, '');
    if (prevTail && prevTail === nextHead) {
      overlapCount = n;
      break;
    }
  }

  if (overlapCount > 0) {
    const remainingNext = nextWords.slice(overlapCount).join(' ');
    return remainingNext ? `${prev} ${remainingNext}` : prev;
  }

  return `${prev} ${next}`;
}

function initLivePcmStreamer(audioStream) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!state.audioContext || state.audioContext.state === 'closed') {
      state.audioContext = new AudioContext();
    }
    const source = state.audioContext.createMediaStreamSource(audioStream);

    // ScriptProcessor for continuous raw PCM capture
    const bufferSize = 4096;
    pcmProcessorNode = state.audioContext.createScriptProcessor(bufferSize, 1, 1);
    pcmAccumulatedBuffers = [];
    recentRmsLevels = [];
    lastTranscribedSnippet = '';

    pcmProcessorNode.onaudioprocess = (e) => {
      if (!state.isRecording || state.isPaused) return;
      const channelData = e.inputBuffer.getChannelData(0);

      // Instantaneous RMS calculation for VAD (Voice Activity Detection)
      let sumSq = 0;
      for (let i = 0; i < channelData.length; i++) {
        sumSq += channelData[i] * channelData[i];
      }
      const frameRms = Math.sqrt(sumSq / channelData.length);
      recentRmsLevels.push(frameRms);
      if (recentRmsLevels.length > 20) recentRmsLevels.shift(); // keep last ~1.7s

      pcmAccumulatedBuffers.push(new Float32Array(channelData));
    };

    source.connect(pcmProcessorNode);
    pcmProcessorNode.connect(state.audioContext.destination);

    // Smart Adaptive VAD Slicing: Check every 500ms
    clearInterval(liveChunkTimer);
    liveChunkTimer = setInterval(async () => {
      if (!state.isRecording || state.isPaused || isChunkTranscribing) return;
      if (pcmAccumulatedBuffers.length === 0) return;

      const sr = state.audioContext.sampleRate;
      const totalSamples = pcmAccumulatedBuffers.reduce((acc, b) => acc + b.length, 0);
      const durationSec = totalSamples / sr;

      // Minimum 3.5s before considering a slice
      if (durationSec < 3.5) return;

      // Check if recent ~350ms is a quiet pause / breath between words
      const recentSlice = recentRmsLevels.slice(-4);
      const avgRecentRms = recentSlice.reduce((a, b) => a + b, 0) / (recentSlice.length || 1);
      const isQuietPause = avgRecentRms < 0.015;

      // Slice condition:
      // A) Natural silence pause occurred after 3.8s, OR
      // B) Continuous monologue reached 6.5s (slice with 0.8s overlap to prevent cutting mid-word)
      const shouldSlice = (isQuietPause && durationSec >= 3.8) || (durationSec >= 6.5);

      if (!shouldSlice) return;

      const overlapSec = 0.8;
      const overlapSamples = Math.floor(sr * overlapSec);
      const currentBuffers = pcmAccumulatedBuffers;

      // Flatten current audio
      const flatSamples = new Float32Array(totalSamples);
      let offset = 0;
      for (const b of currentBuffers) {
        flatSamples.set(b, offset);
        offset += b.length;
      }

      // Retain 0.8s overlap for next buffer so boundary words are never halved
      if (totalSamples > overlapSamples) {
        const remainingOverlap = flatSamples.slice(totalSamples - overlapSamples);
        pcmAccumulatedBuffers = [remainingOverlap];
      } else {
        pcmAccumulatedBuffers = [];
      }

      const wavBlob = encodeWAV16k(flatSamples, sr);
      const currentSec = state.recordingSeconds;
      await processLiveChunkSTT(wavBlob, currentSec, lastTranscribedSnippet);
    }, 500);
  } catch (err) {
    console.warn('Live PCM Streamer init error:', err);
  }
}

function startBrowserSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;
  try {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'ko-KR';

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (!text || text.length < 2) continue;

          const segStartSec = state.recordingSeconds;
          const timeStr = formatSeconds(segStartSec);
          const maxSpk = state.targetSpeakerCount === 'auto' ? 3 : parseInt(state.targetSpeakerCount || '3', 10);
          const lastDiag = state.dialogues[state.dialogues.length - 1];
          let speaker = '화자 1';

          if (lastDiag) {
            const timeGap = segStartSec - (lastDiag.end_seconds || lastDiag.start_seconds || 0);
            const lastText = (lastDiag.text || '').trim();
            const endsWithQuestion = /[?？]$/.test(lastText);
            const isResponse = /^(네|아니|오빠|맞아|그래|근데|글쎄|저기|그렇|아\s|어\s|나도)/.test(text);

            if (timeGap < 1.2 && !endsWithQuestion && !isResponse) {
              speaker = lastDiag.originalSpeaker || '화자 1';
              lastDiag.text = mergeContinuousText(lastDiag.text, text);
              lastDiag.end_seconds = segStartSec + 3;
              renderDialogueFeed();
              triggerAutoSave();
              return;
            } else {
              const lastNum = parseInt((lastDiag.originalSpeaker || '화자 1').replace(/\D/g, '') || '1', 10);
              speaker = `화자 ${(lastNum % maxSpk) + 1}`;
            }
          }

          state.dialogues.push({
            time: timeStr,
            start_seconds: segStartSec,
            end_seconds: segStartSec + 3,
            speaker: speaker,
            originalSpeaker: speaker,
            text: text
          });

          renderSpeakerMappingBar();
          renderDialogueFeed();
          compilePromptPackage();
          triggerAutoSave();
          if (el.dialogueFeed) {
            el.dialogueFeed.scrollTop = el.dialogueFeed.scrollHeight;
          }
        }
      }
    };

    rec.onerror = (e) => {
      console.warn('SpeechRecognition error:', e);
    };

    rec.onend = () => {
      if (state.isRecording && !state.isPaused) {
        try { rec.start(); } catch (_) {}
      }
    };

    rec.start();
    state.speechRec = rec;
  } catch (e) {
    console.warn('SpeechRecognition start failed:', e);
  }
}

async function startRecording(sourceType = 'mic') {
  try {
    // 1. Prepare completely clean meeting state (no old sample dialogues mixed in!)
    prepareFreshMeeting(sourceType === 'loopback' ? '유튜브 / PC 녹음 회의록' : '실시간 마이크 회의록');

    let rawStream;
    if (sourceType === 'loopback') {
      rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Crucial Check: Did the user check "Share tab audio"?
      if (rawStream.getAudioTracks().length === 0) {
        rawStream.getTracks().forEach(t => t.stop());
        alert('⚠️ [필독] 오디오(소리)가 공유되지 않았습니다!\n\n크롬 화면 공유 창이 뜰 때 반드시 [Chrome 탭]을 선택하시고,\n창 좌측 하단의 [탭 오디오도 공유] 체크박스를 켜주셔야 영상 소리가 시스템으로 전달됩니다.');
        showToast('⚠️ 화면 공유 창에서 [탭 오디오도 공유]를 꼭 켜주세요!', 6000);
        return;
      }

      state.rawDisplayStream = rawStream;
    } else {
      rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });
      state.rawDisplayStream = null;
    }

    // Build pure audio stream for MediaRecorder and AudioVisualizer (no video tracks attached)
    const audioTracks = rawStream.getAudioTracks();
    const audioStream = new MediaStream(audioTracks);

    // Listen to Chrome's native "공유 중지" (Stop sharing) button on either audio or video track
    const handleStreamEnd = () => {
      if (state.isRecording) {
        showToast('화면 공유가 종료되어 녹음을 완료하고 최종 전사를 마칩니다.');
        finishRecordingAndTranscribe();
      }
    };
    if (audioTracks[0]) audioTracks[0].onended = handleStreamEnd;
    if (rawStream.getVideoTracks && rawStream.getVideoTracks()[0]) {
      rawStream.getVideoTracks()[0].onended = handleStreamEnd;
    }

    state.audioStream = audioStream;
    state.audioChunks = [];
    state.recordingSeconds = 0;
    state.isRecording = true;
    state.isPaused = false;
    silentSeconds = 0;
    silentWarned = false;

    // Web Audio API for Live Waveform & Silence Detection
    initAudioVisualizer(audioStream);

    // High-Precision 16kHz WAV Live Streaming to Faster-Whisper
    initLivePcmStreamer(audioStream);

    // Browser Web Speech API fallback for Serverless GitHub Pages
    const hasBack = await StorageAdapter.hasBackend();
    if (!hasBack && sourceType === 'mic') {
      startBrowserSpeechRecognition();
    }

    // Continuous Full WebM Recorder for final audio archive
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];
    let selectedMime = '';
    for (const m of mimeCandidates) {
      if (MediaRecorder.isTypeSupported(m)) {
        selectedMime = m;
        break;
      }
    }

    const recOptions = selectedMime ? { mimeType: selectedMime } : undefined;
    state.mediaRecorder = new MediaRecorder(audioStream, recOptions);
    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.start(1000); // 1-second chunks for complete archive

    // Automatically switch view to Transcription Tab so user sees speech in real time!
    document.querySelector('.doc-tab-btn[data-tab="transcription"]')?.click();

    // UI Updates
    el.recordingBanner.style.display = 'flex';
    el.recStatusText.textContent = sourceType === 'loopback' ? '유튜브 / PC 소리 실시간 듣는 중 (5초마다 전사)...' : '마이크 실시간 녹음 중...';
    el.recordingTimer.textContent = '00:00';

    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      if (!state.isPaused) {
        state.recordingSeconds++;
        el.recordingTimer.textContent = formatSeconds(state.recordingSeconds);
      }
    }, 1000);

    showToast('🎙️ 녹음 및 실시간 전사가 시작되었습니다! 대화의 자연스러운 호흡에 맞춰 화면에 매끄럽게 기록됩니다.');
  } catch (err) {
    console.error('Recording start error:', err);
    showToast(`녹음 시작 실패: ${err.message}`);
  }
}

async function processLiveChunkSTT(chunkBlob, currentSec, prevSnippet) {
  if (isChunkTranscribing) return;
  isChunkTranscribing = true;

  try {
    const hasBack = await StorageAdapter.hasBackend();
    let data = null;

    if (hasBack) {
      const headers = {};
      if (prevSnippet) {
        headers['x-previous-text'] = encodeURIComponent(prevSnippet.slice(-80));
      }

      const res = await fetch('/api/stream-chunk', {
        method: 'POST',
        headers: headers,
        body: chunkBlob
      });

      if (res.ok) {
        data = await res.json();
      }
    } else if (state.settings.groqKey) {
      // Serverless GitHub Pages: Live chunk transcription using free Groq Whisper Large-v3
      const fd = new FormData();
      fd.append('file', chunkBlob, 'chunk.wav');
      fd.append('model', 'whisper-large-v3');
      fd.append('language', 'ko');
      fd.append('response_format', 'verbose_json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.settings.groqKey}` },
        body: fd
      });

      if (res.ok) {
        const groqData = await res.json();
        data = {
          segments: (groqData.segments || []).map(s => ({
            start_seconds: s.start,
            end_seconds: s.end,
            text: s.text,
            pitch: 0
          }))
        };
      }
    } else {
      // No backend and no Groq key: Browser Web Speech API handles mic transcription directly!
      return;
    }

    if (data && data.segments && data.segments.length > 0) {
      data.segments.forEach(seg => {
        // Clean up trailing and leading ellipses ("...")
        let text = (seg.text || '')
          .replace(/^[\s\.\,\…\~]+/, '')
          .replace(/[\s\.\,\…\~]+$/, '')
          .replace(/\.{2,}/g, '.')
          .trim();

        if (!text || text.length < 2) return;

        lastTranscribedSnippet = text;
        const segStartSec = Math.max(0, currentSec - 5 + (seg.start_seconds || 0));
        const timeStr = formatSeconds(segStartSec);

        // Active speaker boundary control: Default max 3-4 speakers
        const maxSpk = state.targetSpeakerCount === 'auto' ? 4 : parseInt(state.targetSpeakerCount || '3', 10);
        const lastDiag = state.dialogues[state.dialogues.length - 1];

        let speaker = '화자 1';
        let shouldMerge = false;

        if (lastDiag) {
          const timeGap = segStartSec - (lastDiag.end_seconds || lastDiag.start_seconds || 0);

          // Multi-Factor Turn Detection (질문, 추임새, 문장 종결, 피치 점프 분석)
          const lastText = (lastDiag.text || '').trim();
          const endsWithQuestion = /[?？]$/.test(lastText);
          const isResponsiveInterjection = /^(네|아니|오빠|맞아|그래|근데|글쎄|저기|그렇|아\s|어\s|나도)/.test(text);

          const pitchGap = (seg.pitch && lastDiag.pitch) ? Math.abs(seg.pitch - lastDiag.pitch) : 0;
          const isSameVoice = pitchGap < 35;

          // Only merge if very tight single-breath pause (< 1.0s) without question/interjection turn
          if (timeGap < 1.0 && !endsWithQuestion && !isResponsiveInterjection && (seg.pitch ? isSameVoice : true)) {
            speaker = lastDiag.originalSpeaker || '화자 1';
            shouldMerge = true;
          } else {
            // Conversational turn occurred! Alternate to next speaker in pool
            const maxSpk = state.targetSpeakerCount === 'auto' ? 3 : parseInt(state.targetSpeakerCount || '3', 10);
            const lastNum = parseInt((lastDiag.originalSpeaker || '화자 1').replace(/\D/g, '') || '1', 10);
            const nextNum = (lastNum % maxSpk) + 1;
            speaker = `화자 ${nextNum}`;
            shouldMerge = false;
          }
        }

        if (shouldMerge && lastDiag) {
          // Merge continuous text without duplicating words or cutting with "..."
          lastDiag.text = mergeContinuousText(lastDiag.text, text);
          lastDiag.end_seconds = Math.max(lastDiag.end_seconds || 0, segStartSec + (seg.end_seconds || 4));
          if (seg.pitch) lastDiag.pitch = seg.pitch;

          // Directly update the last bubble text in DOM for seamless, flicker-free rendering
          const lastBubble = el.dialogueFeed.querySelector('.dialogue-bubble:last-child');
          if (lastBubble) {
            const textEl = lastBubble.querySelector('.dialogue-text');
            if (textEl) textEl.textContent = lastDiag.text;
          }
        } else {
          // New speaker bubble on turn or pause
          state.dialogues.push({
            time: timeStr,
            start_seconds: segStartSec,
            end_seconds: segStartSec + (seg.end_seconds || 4),
            speaker: speaker,
            originalSpeaker: speaker,
            text: text,
            pitch: seg.pitch || 0
          });
          renderDialogueFeed();
        }
      });

      renderSpeakerMappingBar();
      compilePromptPackage();

      // Auto-scroll to bottom of dialogue feed
      if (el.dialogueFeed) {
        el.dialogueFeed.scrollTop = el.dialogueFeed.scrollHeight;
      }
    }
  } catch (err) {
    console.warn('Live chunk STT warning:', err);
  } finally {
    isChunkTranscribing = false;
  }
}

function initAudioVisualizer(stream) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContext();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 64;
    source.connect(state.analyser);

    drawWaveform();
  } catch (e) {
    console.warn('Audio visualizer error:', e);
  }
}

function drawWaveform() {
  if (!state.isRecording) return;
  requestAnimationFrame(drawWaveform);

  const canvas = el.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let totalVolume = 0;
  const barWidth = (canvas.width / bufferLength) * 1.5;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const val = dataArray[i];
    totalVolume += val;
    const barHeight = (val / 255) * canvas.height;
    ctx.fillStyle = state.isPaused ? '#94a3b8' : '#ef4444';
    ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
    x += barWidth;
  }

  // Silence alert: If volume is 0 for > 7 seconds
  const avgVolume = totalVolume / bufferLength;
  if (avgVolume < 1.5) {
    silentSeconds += 0.016; // approx 60fps
    if (silentSeconds > 7 && !silentWarned) {
      silentWarned = true;
      showToast('⚠️ 영상 소리가 감지되지 않습니다. 유튜브 탭의 볼륨이 켜져 있는지, [탭 오디오 공유]가 켜졌는지 확인하세요!', 7000);
    }
  } else {
    silentSeconds = 0;
  }
}

function togglePauseRecording() {
  if (!state.isRecording) return;
  if (state.isPaused) {
    state.mediaRecorder.resume();
    state.isPaused = false;
    el.pauseRecBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> 일시 정지';
    el.recStatusText.textContent = '실시간 녹음 재개됨';
  } else {
    state.mediaRecorder.pause();
    state.isPaused = true;
    el.pauseRecBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> 계속 녹음';
    el.recStatusText.textContent = '녹음 일시 정지됨';
  }
}

function cancelRecording() {
  stopStreamTracks();
  clearInterval(state.timerInterval);
  clearInterval(liveChunkTimer);
  state.isRecording = false;
  el.recordingBanner.style.display = 'none';
  showToast('녹음이 취소되었습니다.');
}

async function finishRecordingAndTranscribe() {
  if (!state.isRecording) return;
  stopStreamTracks();
  clearInterval(state.timerInterval);
  clearInterval(liveChunkTimer);
  state.isRecording = false;

  el.recStatusText.textContent = '오디오 데이터 패키징 중...';
  el.stopRecBtn.disabled = true;

  state.mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(state.audioChunks, { type: 'audio/webm' });
    el.recordingBanner.style.display = 'none';
    el.stopRecBtn.disabled = false;

    showToast('⚡ 오디오 저장 및 전체 Whisper AI 고정밀 정리를 완료합니다...');
    await uploadAndTranscribeBlob(audioBlob, `rec_${Date.now()}.webm`);
  };

  state.mediaRecorder.stop();
}

function stopStreamTracks() {
  if (state.speechRec) {
    try { state.speechRec.stop(); } catch (_) {}
    state.speechRec = null;
  }
  if (pcmProcessorNode) {
    try { pcmProcessorNode.disconnect(); } catch (_) {}
    pcmProcessorNode = null;
  }
  pcmAccumulatedBuffers = [];

  if (state.rawDisplayStream) {
    state.rawDisplayStream.getTracks().forEach(t => t.stop());
    state.rawDisplayStream = null;
  }
  if (state.audioStream) {
    state.audioStream.getTracks().forEach(t => t.stop());
    state.audioStream = null;
  }
  if (state.audioContext && state.audioContext.state !== 'closed') {
    state.audioContext.close();
    state.audioContext = null;
  }
}

// --------------------------------------------------------------------------
// YouTube Direct URL Transcription Handler (초고속 URL 전사)
// --------------------------------------------------------------------------
async function handleYoutubeDirectTranscribe() {
  const url = el.youtubeUrlInput.value.trim();
  if (!url) {
    showToast('유튜브 링크 주소를 입력해 주세요.');
    return;
  }

  el.youtubeUrlModal.style.display = 'none';
  // Prepare fresh meeting state to isolate completely from prior meetings
  prepareFreshMeeting('유튜브 영상 전사');

  el.audioStatusIndicator.textContent = '유튜브 음원 추출 및 Whisper 전사 중...';
  el.audioStatusIndicator.classList.remove('ready');

  showToast('⚡ 유튜브 음원을 초고속 추출하여 Whisper AI 전사를 시작합니다...');

  try {
    const numSpeakersParam = state.targetSpeakerCount && state.targetSpeakerCount !== 'auto'
      ? parseInt(state.targetSpeakerCount, 10)
      : null;

    const res = await fetch('/api/youtube-transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        model: state.settings.sttEngine.replace('whisper-', ''),
        language: 'ko',
        num_speakers: numSpeakersParam
      })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || '유튜브 전사 실패');
    }

    state.title = data.title || state.title;
    state.category = '유튜브 전사';
    state.duration = data.duration || 0;
    state.dialogues = data.dialogues || [];
    setAudioSource(data.audioUrl);

    renderMeetingView();

    // Auto switch to transcription tab
    document.querySelector('.doc-tab-btn[data-tab="transcription"]')?.click();
    showToast(`🎉 유튜브 전사 완료! 총 ${state.dialogues.length}개 발언이 기록되었습니다.`);
    triggerAutoSave();
  } catch (err) {
    console.error('YouTube transcribe error:', err);
    el.audioStatusIndicator.textContent = '전사 오류';
    showToast(`유튜브 전사 실패: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Streaming Large File Upload & Faster-Whisper
// --------------------------------------------------------------------------
async function handleAudioFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Prepare fresh meeting state for uploaded file
  prepareFreshMeeting(file.name.replace(/\.[^/.]+$/, ''));

  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  showToast(`📁 ${file.name} (${sizeMb}MB) 업로드 및 전사 시작...`);

  await uploadAndTranscribeBlob(file, file.name);
  e.target.value = ''; // reset
}

async function uploadAndTranscribeBlob(blob, filename) {
  el.audioStatusIndicator.textContent = 'AI 전사 처리 중...';
  el.audioStatusIndicator.classList.remove('ready');

  // 1. Try local Node backend if available
  if (await StorageAdapter.hasBackend()) {
    try {
      const numSpeakersParam = state.targetSpeakerCount && state.targetSpeakerCount !== 'auto'
        ? state.targetSpeakerCount
        : '';

      const res = await fetch('/api/upload-and-transcribe', {
        method: 'POST',
        headers: {
          'x-file-name': encodeURIComponent(filename),
          'x-meeting-id': state.currentMeetingId || '',
          'x-stt-engine': state.settings.sttEngine,
          'x-num-speakers': numSpeakersParam
        },
        body: blob
      });

      if (res.ok) {
        const data = await res.json();
        if (data.dialogues) {
          state.dialogues = data.dialogues || [];
          if (data.audioUrl) setAudioSource(data.audioUrl);
          if (data.duration) {
            state.duration = data.duration;
            el.audioDurationBadge.textContent = formatSeconds(data.duration);
          }
          renderSpeakerMappingBar();
          renderDialogueFeed();
          compilePromptPackage();
          document.querySelector('.doc-tab-btn[data-tab="transcription"]').click();
          showToast(`🎉 전사 완료! 총 ${state.dialogues.length}개 발언이 기록되었습니다.`);
          triggerAutoSave();
          return;
        }
      }
    } catch (e) {
      console.warn('Backend upload failed, attempting client fallback:', e);
    }
  }

  // 2. Client-side Groq Whisper API (Serverless GitHub Pages Mode)
  if (state.settings.groqKey) {
    try {
      showToast('⚡ Groq Whisper Large-v3로 클라우드 초고속 무료 전사 중...');
      const formData = new FormData();
      formData.append('file', blob, filename || 'recording.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'ko');
      formData.append('response_format', 'verbose_json');

      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.settings.groqKey}` },
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        const maxK = state.targetSpeakerCount === 'auto' ? 3 : parseInt(state.targetSpeakerCount || '3', 10);
        const dialogues = (data.segments || []).map((seg, idx) => ({
          time: formatSeconds(seg.start),
          start_seconds: seg.start,
          end_seconds: seg.end,
          speaker: `화자 ${(idx % maxK) + 1}`,
          originalSpeaker: `화자 ${(idx % maxK) + 1}`,
          text: seg.text.trim()
        }));

        state.dialogues = dialogues;
        state.duration = Math.round(data.duration || (dialogues.length * 3));
        setAudioSource(URL.createObjectURL(blob));
        renderSpeakerMappingBar();
        renderDialogueFeed();
        compilePromptPackage();
        document.querySelector('.doc-tab-btn[data-tab="transcription"]').click();
        showToast(`🎉 Groq Whisper 전사 완료! 총 ${dialogues.length}개 발언이 기록되었습니다.`);
        triggerAutoSave();
        return;
      }
    } catch (err) {
      console.warn('Groq Whisper error:', err);
    }
  }

  // 3. Fallback when on GitHub Pages with no backend and no Groq API Key
  setAudioSource(URL.createObjectURL(blob));
  el.audioStatusIndicator.textContent = '오디오 준비됨 (수동/API 필요)';
  showToast('💡 깃허브 페이지 서버리스 모드: [설정 ⚙️]에서 무료 Groq API 키를 등록하면 1초 만에 무료 전사됩니다. (실시간 녹음은 키 없이 브라우저 음성인식 지원!)', 6000);
}

// --------------------------------------------------------------------------
// Sample Demo Loader
// --------------------------------------------------------------------------
async function loadSampleDemo() {
  showToast('⚡ 47분 분량 실제 회의/방송 전사 샘플 데이터를 불러옵니다...');
  try {
    const res = await fetch('/api/test-sample');
    const data = await res.json();

    if (data.success && data.meeting) {
      applyMeetingDataToState(data.meeting);
      renderMeetingView();
      showToast('🎉 47분 실제 전사본이 완벽하게 로드되었습니다! 화자 실명을 입력해 보세요.');
    } else {
      throw new Error(data.error || '샘플 로드 실패');
    }
  } catch (err) {
    showToast(`샘플 로드 오류: ${err.message}`);
  }
}

// --------------------------------------------------------------------------
// Meeting Persistence & Server REST API (Dual-Mode: Backend + Serverless)
// --------------------------------------------------------------------------
async function loadMeetingList() {
  try {
    const meetings = await StorageAdapter.listMeetings();

    el.meetingList.innerHTML = '';
    el.meetingCountBadge.textContent = (meetings || []).length.toString();

    (meetings || []).forEach(m => {
      const li = document.createElement('li');
      li.className = `meeting-item ${m.id === state.currentMeetingId ? 'active' : ''}`;
      li.dataset.id = m.id;

      li.innerHTML = `
        <div class="meeting-item-info">
          <span class="meeting-item-title">${escapeHtml(m.title || '새 회의록')}</span>
          <span class="meeting-item-meta">${m.date || ''} · ${m.duration ? formatSeconds(m.duration) : '0분'}</span>
        </div>
        <button class="meeting-item-del-btn" title="삭제">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;

      li.querySelector('.meeting-item-info').addEventListener('click', () => openMeeting(m.id));
      li.querySelector('.meeting-item-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMeeting(m.id);
      });

      el.meetingList.appendChild(li);
    });
  } catch (err) {
    console.error('Failed to load meeting list:', err);
  }
}

async function openMeeting(meetingId) {
  try {
    const meeting = await StorageAdapter.getMeeting(meetingId);
    if (!meeting) return;
    applyMeetingDataToState(meeting);
    renderMeetingView();
    updateMeetingListActiveState();
    if (window.innerWidth <= 920) {
      el.sidebar.classList.add('collapsed');
      el.sidebar.classList.remove('open');
      el.sidebarBackdrop?.classList.remove('active');
    }
  } catch (err) {
    console.error('Failed to open meeting:', err);
  }
}

async function saveCurrentMeetingToServer() {
  const payload = {
    id: state.currentMeetingId || `meet_${Date.now()}`,
    title: state.title,
    date: state.date,
    attendees: state.attendees,
    category: state.category,
    agenda: state.agenda,
    notes: state.notes,
    audioUrl: state.audioUrl,
    duration: state.duration,
    dialogues: state.dialogues,
    speakerMap: state.speakerMap,
    preset: state.selectedPreset,
    customInstruction: state.customInstruction,
    summary: state.summary
  };

  state.currentMeetingId = payload.id;
  const saved = await StorageAdapter.saveMeeting(payload);
  await loadMeetingList();
  return saved;
}

async function deleteMeeting(meetingId) {
  if (!confirm('정말로 이 회의록을 삭제하시겠습니까?')) return;
  try {
    await StorageAdapter.deleteMeeting(meetingId);
    showToast('회의록이 삭제되었습니다.');
    await loadMeetingList();
    if (state.currentMeetingId === meetingId) {
      resetToNewMeeting();
    }
  } catch (err) {
    showToast(`삭제 실패: ${err.message}`);
  }
}

function resetToNewMeeting() {
  state.currentMeetingId = `meet_${Date.now()}`;
  state.title = '새 회의록';
  state.date = new Date().toISOString().split('T')[0];
  state.attendees = '';
  state.category = '내 회의';
  state.agenda = '';
  state.notes = '';
  state.audioUrl = null;
  state.duration = 0;
  state.dialogues = [];
  state.speakerMap = {};
  state.selectedPreset = 'executive';
  state.customInstruction = '';
  state.summary = null;

  renderMeetingView();
  updateMeetingListActiveState();
}

function applyMeetingDataToState(data) {
  state.currentMeetingId = data.id;
  state.title = data.title || '새 회의록';
  state.date = data.date || new Date().toISOString().split('T')[0];
  state.attendees = data.attendees || data.participants || '';
  state.category = data.category || data.location || '내 회의';
  state.agenda = data.agenda || '';
  state.notes = data.notes || '';
  state.audioUrl = data.audioUrl || (data.audioFile ? `/recordings/${data.audioFile}` : null);
  state.duration = data.duration || 0;
  state.dialogues = data.dialogues || [];
  state.speakerMap = data.speakerMap || {};
  state.selectedPreset = data.preset || 'executive';
  state.customInstruction = data.customInstruction || '';
  state.summary = data.summary || null;
}

function renderMeetingView() {
  el.docTitleInput.value = state.title;
  el.breadcrumbTitle.textContent = state.title;
  el.docDateInput.value = state.date;
  el.docAttendeesInput.value = state.attendees;
  el.docCategoryInput.value = state.category;
  el.agendaInput.value = state.agenda;
  el.meetingNotesInput.value = state.notes;
  el.customInstructionInput.value = state.customInstruction;

  setAudioSource(state.audioUrl);
  if (state.duration) {
    el.audioDurationBadge.textContent = formatSeconds(state.duration);
  }

  // Preset Card UI Active
  document.querySelectorAll('.preset-card').forEach(card => {
    card.classList.toggle('active', card.dataset.preset === state.selectedPreset);
  });

  renderSpeakerMappingBar();
  renderDialogueFeed();
  compilePromptPackage();

  if (state.summary) {
    renderAiSummary(state.summary);
    el.aiStatusBadge.textContent = '완료';
  } else {
    el.aiResultBody.innerHTML = `
      <div class="result-empty-hint">
        상단의 <strong>[내장 AI로 즉시 요약 실행]</strong>을 누르거나 <strong>[다른 AI용 프롬프트 패키지 복사]</strong>를 눌러 외부 AI에서 고품질 회의록을 생성하세요.
      </div>`;
    el.aiStatusBadge.textContent = '준비';
  }
}

function updateMeetingListActiveState() {
  document.querySelectorAll('.meeting-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === state.currentMeetingId);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Kickoff (Runs immediately if DOM already loaded)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
