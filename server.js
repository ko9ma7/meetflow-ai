/**
 * Notion AI Meeting Notes & Transcription Server
 * Featuring Built-in Local Faster-Whisper AI STT & Streaming Audio Engine
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data', 'meetings');
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure directories exist
[DATA_DIR, RECORDINGS_DIR, PUBLIC_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8'
};

// Helper: Parse JSON body with large limit
function parseJsonBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Run Local Faster-Whisper Python Process
function runWhisper(params, language = 'ko', modelSize = 'base') {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'transcribe.py');
    const py = spawn('python', [scriptPath], {
      cwd: __dirname,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', d => { stdout += d.toString('utf-8'); });
    py.stderr.on('data', d => { stderr += d.toString('utf-8'); });

    py.on('close', code => {
      try {
        const json = JSON.parse(stdout);
        resolve(json);
      } catch (e) {
        reject(new Error(stderr || stdout || 'Failed to parse whisper output'));
      }
    });

    py.on('error', reject);

    const payload = typeof params === 'string'
      ? { audio_path: params, language, model: modelSize }
      : params;

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

// Helper: Smart Local Summarizer for Korean/English meetings
function generateLocalSummary(title, agenda, transcript, participants) {
  const lines = (transcript || '').split('\n').map(l => l.trim()).filter(Boolean);
  const allText = lines.map(l => l.replace(/^\[\d{2}:\d{2}\]\s*[^:]+:\s*/, '')).join(' ');
  const sentences = allText.split(/(?<=[.?!])\s+/).filter(s => s.length > 5);

  let executiveSummary = '';
  if (sentences.length <= 3) {
    executiveSummary = allText || '회의가 간략하게 진행되었으며 세부 발화 내용이 자동으로 기록되었습니다.';
  } else {
    executiveSummary = `본 회의에서는 '${title}'을(를) 주제로 참석자(${participants || '전체 팀원'})가 모여 주요 안건을 검토하고 진행 상황 및 향후 계획을 심도 있게 논의하였습니다. ` +
      (sentences.slice(0, 2).join(' '));
  }

  const keyPoints = [];
  if (agenda && agenda.trim()) {
    keyPoints.push(`**사전 안건 확인**: ${agenda.trim()}`);
  }
  
  const topicKeywords = ['논의', '진행', '개발', '일정', '문제', '개선', '고려', '결과', '검토', '기능', '테스트', '수집', '시스템'];
  const matchedPoints = sentences.filter(s => topicKeywords.some(k => s.includes(k)));
  
  if (matchedPoints.length > 0) {
    matchedPoints.slice(0, 4).forEach(p => keyPoints.push(p));
  } else if (sentences.length > 0) {
    sentences.slice(0, 3).forEach(p => keyPoints.push(p));
  } else {
    keyPoints.push('주요 논의 사항이 기록되었습니다.');
  }

  const decisionKeywords = ['결정', '하기로', '합의', '확정', '완료', '도입', '적용', '유지하기로'];
  const decisionLines = sentences.filter(s => decisionKeywords.some(k => s.includes(k)));
  const decisions = decisionLines.length > 0 
    ? decisionLines.slice(0, 3) 
    : ['추가적인 공식 결정 사항은 다음 미팅에서 재확인하기로 합의함.'];

  const actionKeywords = ['할 일', '담당', '제출', '확인', '공유', '준비', '개발', '조사', '보고', '작성', '검토', '진행하겠습니다'];
  const actionLines = sentences.filter(s => actionKeywords.some(k => s.includes(k)));
  const actionItems = [];
  
  if (actionLines.length > 0) {
    actionLines.slice(0, 4).forEach((act, idx) => {
      actionItems.push({
        task: act.replace(/^[•\-\*\s]+/, ''),
        assignee: participants ? participants.split(',')[idx % participants.split(',').length].trim() : '담당자',
        deadline: '차주 회의 전까지',
        done: false
      });
    });
  } else {
    actionItems.push(
      { task: `${title} 관련 논의 사항 문서화 및 팀 공유`, assignee: '작성자', deadline: '오늘', done: false },
      { task: '후속 조치 사항 체크 및 다음 회의 일정 수립', assignee: '전체', deadline: '이번 주', done: false }
    );
  }

  return { executiveSummary, keyPoints, decisions, actionItems };
}

// Supported AI Prompt Directions
const PROMPT_DIRECTIONS = {
  executive: {
    name: '경영진 보고용 핵심 요약 (Executive Briefing)',
    instruction: '경영진 및 C-Level 보고용 브리핑입니다. 사소한 대화는 배제하고 결론 중심의 3줄 요약, 핵심 의사결정 사항, 비즈니스 리스크 및 예상 영향도를 분석해 주세요.'
  },
  action_items: {
    name: '실무 액션 아이템 & 할 일 목록 (Task & Action Tracker)',
    instruction: '실무진 협업용 할 일 중심 정리입니다. 모든 논의 사항을 담당자별 액션 아이템으로 세분화하고 마감 기한과 선행 작업/우선순위를 명확히 정리해 주세요.'
  },
  technical: {
    name: '기술 개발 & 엔지니어링 미팅 (Tech Spec & Architecture)',
    instruction: '개발팀 엔지니어링 회의입니다. 시스템 아키텍처 결정 사항, API 및 데이터 인터페이스 규격, 기술적 병목 및 해결 방안, 단위/통합 테스트 계획을 중심으로 상세히 기술해 주세요.'
  },
  sales_interview: {
    name: '고객 인터뷰 & 영업 미팅 (Customer Voice & Sales VOC)',
    instruction: '고객사 및 영업 미팅입니다. 고객의 주요 요구사항과 현행 애로사항(Pain Point), 자사 제안 내용 및 고객의 피드백, 다음 영업 팔로업 일정을 중심으로 작성해 주세요.'
  },
  qa_decision: {
    name: '결정 사항 & 질의응답 렛저 (Decisions & Q&A Ledger)',
    instruction: '회의 중 오간 핵심 질문과 답변, 그리고 최종 합의/결정된 사항을 질의응답 로그(Q&A Ledger) 형태로 일목요연하게 정리해 주세요.'
  },
  email: {
    name: '팀 공유용 이메일 공지 (Team Email / Memo)',
    instruction: '팀원 및 사내 전체에 발송할 수 있는 깔끔하고 정중한 이메일 공지문 형태로 회의 결과와 후속 협조 요청 사항을 작성해 주세요.'
  },
  custom: {
    name: '사용자 지정 맞춤 지침 (Custom Prompt)',
    instruction: '사용자가 지정한 특별 지침에 따라 정리해 주세요.'
  }
};

// Helper: Call AI API (Gemini or OpenAI compatible) with Directional Prompt
async function generateAISummary(title, agenda, transcript, participants, config = {}) {
  const modeKey = config.mode || 'executive';
  const direction = PROMPT_DIRECTIONS[modeKey] || PROMPT_DIRECTIONS.executive;
  const customNote = config.customInstruction ? `\n[추가 맞춤 지침]: ${config.customInstruction}` : '';

  const prompt = `당신은 최고 수준의 AI 회의록 분석 및 비즈니스 인텔리전스 전문가입니다.
아래의 대화 녹취록(Transcript)과 회의 정보를 바탕으로, 지정된 [분석 지침]에 맞추어 전문적이고 명확하게 회의 결과를 정리해 주세요.

[회의 정보]
- 회의 제목: ${title}
- 참석자: ${participants || '미기재'}
- 사전 메모 및 안건: ${agenda || '없음'}

[분석 및 정리 지침]
- 요약 방향: ${direction.name}
- 핵심 지침: ${direction.instruction}${customNote}

[전체 대화 녹취록(Transcript)]
${transcript}

반드시 아래 JSON 형식으로만 응답해 주세요 (마크다운 코드블록 없이 순수 JSON만 반환):
{
  "modeName": "${direction.name}",
  "executiveSummary": "지침에 부합하는 핵심 요약 (결론 및 주요 골자 2~3문장)",
  "keyPoints": [
    "핵심 논의 내용 1",
    "핵심 논의 내용 2",
    "핵심 논의 내용 3"
  ],
  "decisions": [
    "결정 및 합의 사항 1",
    "결정 및 합의 사항 2"
  ],
  "actionItems": [
    {
      "task": "구체적인 작업 내용",
      "assignee": "담당자명 또는 미정",
      "deadline": "마감 기한 또는 미정",
      "done": false
    }
  ]
}`;

  const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (response.ok) {
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          return JSON.parse(jsonText);
        }
      }
    } catch (e) {
      console.warn('Gemini error, fallback to local:', e.message);
    }
  }

  if (config.openaiKey || process.env.OPENAI_API_KEY) {
    const key = config.openaiKey || process.env.OPENAI_API_KEY;
    const baseUrl = config.openaiBaseUrl || 'https://api.openai.com/v1';
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: config.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        })
      });
      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          return JSON.parse(content);
        }
      }
    } catch (e) {
      console.warn('OpenAI error, fallback to local:', e.message);
    }
  }

  return generateLocalSummary(title, agenda, transcript, participants);
}

// Format summary object into clean Markdown text
function summaryToMarkdown(summary, title = '회의록') {
  if (typeof summary === 'string') return summary;
  let md = `## 📌 ${summary.modeName || '핵심 요약'}\n\n`;
  if (summary.executiveSummary) {
    md += `${summary.executiveSummary}\n\n`;
  }
  if (summary.keyPoints && summary.keyPoints.length > 0) {
    md += `### 💡 주요 논의 내용\n`;
    summary.keyPoints.forEach(p => md += `- ${p}\n`);
    md += `\n`;
  }
  if (summary.decisions && summary.decisions.length > 0) {
    md += `### ⚖️ 의사결정 및 합의 사항\n`;
    summary.decisions.forEach(d => md += `- ${d}\n`);
    md += `\n`;
  }
  if (summary.actionItems && summary.actionItems.length > 0) {
    md += `### 📋 실무 액션 아이템\n`;
    summary.actionItems.forEach(a => {
      const assignee = a.assignee ? ` (@${a.assignee})` : '';
      const deadline = a.deadline ? ` [기한: ${a.deadline}]` : '';
      md += `- [ ] **${a.task}**${assignee}${deadline}\n`;
    });
    md += `\n`;
  }
  return md;
}

// Convert meeting object to Notion-style Markdown
function meetingToMarkdown(meeting) {
  let md = `# ${meeting.title || '새 회의'}\n\n`;
  md += `| 속성 | 내용 |\n| :--- | :--- |\n`;
  md += `| 📅 **날짜** | ${meeting.date || '오늘'} |\n`;
  md += `| 📁 **위치** | ${meeting.location || '내 회의'} |\n`;
  md += `| 👥 **참석자** | ${meeting.participants || '비어 있음'} |\n`;
  if (meeting.calendarEvent) {
    md += `| 🔗 **이벤트** | ${meeting.calendarEvent} |\n`;
  }
  md += `\n---\n\n`;

  if (meeting.agenda && meeting.agenda.trim()) {
    md += `## ✏️ 사전 메모 및 안건\n\n${meeting.agenda}\n\n---\n\n`;
  }

  if (meeting.summary) {
    md += `## ✨ Notion AI 회의 요약\n\n`;
    if (meeting.summary.executiveSummary) {
      md += `> **📌 회의 개요**  \n> ${meeting.summary.executiveSummary}\n\n`;
    }

    if (meeting.summary.keyPoints && meeting.summary.keyPoints.length) {
      md += `### 💡 주요 논의 사항\n`;
      meeting.summary.keyPoints.forEach(p => { md += `- ${p}\n`; });
      md += `\n`;
    }

    if (meeting.summary.decisions && meeting.summary.decisions.length) {
      md += `### 🎯 결정 사항\n`;
      meeting.summary.decisions.forEach(d => { md += `- ${d}\n`; });
      md += `\n`;
    }

    if (meeting.summary.actionItems && meeting.summary.actionItems.length) {
      md += `### ✅ 액션 아이템\n`;
      meeting.summary.actionItems.forEach(item => {
        const check = item.done ? '[x]' : '[ ]';
        md += `- ${check} **${item.task}** (담당: ${item.assignee || '미정'} / 기한: ${item.deadline || '미정'})\n`;
      });
      md += `\n`;
    }
    md += `---\n\n`;
  }

  if (meeting.transcript && meeting.transcript.trim()) {
    md += `## 🎙️ 전체 녹취록 (받아쓰기)\n\n`;
    md += `<details>\n<summary><b>전체 녹취록 펼치기 / 접기</b></summary>\n\n`;
    md += meeting.transcript + `\n\n`;
    md += `</details>\n`;
  }

  return md;
}

// Request Handler
const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);
    const method = req.method;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-filename, x-meeting-id, x-language');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- API Routes ---

    // 1. List Meetings
    if (method === 'GET' && pathname === '/api/meetings') {
      try {
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        const meetings = files.map(f => {
          const content = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
          const data = JSON.parse(content);
          return {
            id: data.id,
            title: data.title || '새 회의',
            date: data.date || '오늘',
            location: data.location || '내 회의',
            participants: data.participants || '',
            updatedAt: data.updatedAt || data.createdAt,
            hasSummary: !!data.summary,
            transcriptLength: (data.transcript || '').length
          };
        }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(meetings));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 2. Get Single Meeting
    if (method === 'GET' && pathname.startsWith('/api/meetings/')) {
      const id = pathname.split('/')[3];
      const filePath = path.join(DATA_DIR, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Meeting not found' }));
      }
      return;
    }

    // 3. Save / Update Meeting
    if (method === 'POST' && pathname === '/api/meetings') {
      try {
        const body = await parseJsonBody(req);
        const id = body.id || `meeting_${Date.now()}`;
        const now = new Date().toISOString();

        const meetingData = {
          ...body,
          id,
          updatedAt: now,
          createdAt: body.createdAt || now
        };

        const filePath = path.join(DATA_DIR, `${id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(meetingData, null, 2), 'utf-8');

        const mdPath = path.join(DATA_DIR, `${id}.md`);
        fs.writeFileSync(mdPath, meetingToMarkdown(meetingData), 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(meetingData));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 4. Delete Meeting
    if (method === 'DELETE' && pathname.startsWith('/api/meetings/')) {
      const id = pathname.split('/')[3];
      const jsonPath = path.join(DATA_DIR, `${id}.json`);
      const mdPath = path.join(DATA_DIR, `${id}.md`);
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
      if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 5. Generate AI Summary (Directional Prompts & Speaker Mapping)
    if (method === 'POST' && pathname === '/api/summarize') {
      try {
        const body = await parseJsonBody(req);
        const { title, agenda, transcript, dialogues, speakerMap, preset, customInstruction, settings, participants, config } = body;

        let finalTranscript = transcript || '';
        if (!finalTranscript && dialogues && Array.isArray(dialogues)) {
          finalTranscript = dialogues.map(d => {
            const orig = d.originalSpeaker || d.speaker || '화자';
            const mappedName = (speakerMap && speakerMap[orig]) || orig;
            const timeStr = d.time || '00:00';
            return `[${timeStr}] ${mappedName}: ${d.text}`;
          }).join('\n');
        }

        if (!finalTranscript || finalTranscript.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '전사된 대화 기록(Transcript)이 비어 있어 요약할 수 없습니다.' }));
          return;
        }

        const effectiveParticipants = participants || (speakerMap ? Object.values(speakerMap).filter(Boolean).join(', ') : '');

        const summaryObj = await generateAISummary(
          title || '새 회의록',
          agenda || '',
          finalTranscript,
          effectiveParticipants,
          {
            mode: preset || (config && config.mode) || 'executive',
            customInstruction: customInstruction || (config && config.customInstruction) || '',
            ...(config || {}),
            apiKey: (settings && settings.apiKey) || (config && config.apiKey)
          }
        );

        const markdown = summaryToMarkdown(summaryObj, title);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ summary: markdown, ...summaryObj }));
      } catch (e) {
        console.error('[Summarize Error]:', e);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 6. Direct Streaming Audio Upload & Whisper AI Transcription (Handles 100MB+ files seamlessly)
    if (method === 'POST' && pathname === '/api/upload-and-transcribe') {
      const originalName = req.headers['x-filename'] || req.headers['x-file-name'] || 'audio_file.mp3';
      const decodedName = decodeURIComponent(originalName);
      const meetingId = req.headers['x-meeting-id'] || `meet_${Date.now()}`;
      const lang = req.headers['x-language'] || 'ko';
      const numSpeakers = req.headers['x-num-speakers'] ? parseInt(req.headers['x-num-speakers'], 10) : null;
      const ext = path.extname(decodedName) || '.mp3';
      const saveFilename = `${meetingId}${ext}`;
      const savePath = path.join(RECORDINGS_DIR, saveFilename);

      console.log(`[Upload] Receiving file: ${decodedName} -> ${saveFilename}`);

      const writeStream = fs.createWriteStream(savePath);
      req.pipe(writeStream);

      writeStream.on('finish', async () => {
        const fileSize = fs.statSync(savePath).size;
        console.log(`[Upload] File saved successfully (${(fileSize / 1024 / 1024).toFixed(2)} MB). Starting Faster-Whisper AI (num_speakers=${numSpeakers})...`);

        try {
          // 1. Run local Faster-Whisper STT with acoustic diarization
          const whisperResult = await runWhisper({
            action: 'transcribe',
            audio_path: savePath,
            language: lang,
            model: 'base',
            num_speakers: numSpeakers
          });
          if (whisperResult.error) {
            throw new Error(whisperResult.error);
          }

          console.log(`[Whisper] Transcribed ${whisperResult.segments?.length || 0} segments (duration: ${whisperResult.duration?.toFixed(1)}s)`);

          const dialogues = (whisperResult.segments || []).map(seg => ({
            time: seg.time,
            start_seconds: seg.start_seconds,
            end_seconds: seg.end_seconds,
            speaker: seg.speaker,
            originalSpeaker: seg.speaker,
            text: seg.text
          }));

          const responseData = {
            audioUrl: `/recordings/${saveFilename}`,
            duration: Math.round(whisperResult.duration || 0),
            dialogues: dialogues,
            segments: dialogues,
            transcript: whisperResult.full_transcript || ''
          };

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(responseData));
        } catch (err) {
          console.error('[Whisper Error]:', err);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '음성 인식(STT) 중 오류가 발생했습니다: ' + err.message }));
        }
      });

      writeStream.on('error', (err) => {
        console.error('[Upload Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '파일 저장 실패: ' + err.message }));
      });
      return;
    }

    // 7. Instant Sample Audio Test Endpoint
    if (method === 'GET' && pathname === '/api/test-sample') {
      // Check if 47-minute real transcript is available
      const sampleMeetFile = path.join(DATA_DIR, 'meet_1794230186543.json');
      if (fs.existsSync(sampleMeetFile)) {
        try {
          const sampleData = JSON.parse(fs.readFileSync(sampleMeetFile, 'utf-8'));
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            success: true,
            meeting: sampleData,
            audioUrl: sampleData.audioUrl || '/recordings/meet_1794230186543.mp3',
            dialogues: sampleData.dialogues,
            duration: sampleData.duration || 2835
          }));
          return;
        } catch (err) {
          console.warn('[Sample Test] Failed to read meet_1794230186543.json:', err.message);
        }
      }

      // Fallback to sample_meeting.wav
      const sampleFile = path.join(RECORDINGS_DIR, 'sample_meeting.wav');
      if (!fs.existsSync(sampleFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Sample audio file not found' }));
        return;
      }

      console.log('[Sample Test] Running Whisper on sample_meeting.wav...');
      try {
        const whisperResult = await runWhisper(sampleFile, 'ko', 'base');
        const dialogues = (whisperResult.segments || []).map(seg => ({
          time: seg.time,
          start_seconds: seg.start_seconds,
          end_seconds: seg.end_seconds,
          speaker: seg.speaker,
          originalSpeaker: seg.speaker,
          text: seg.text
        }));

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          meeting: {
            id: 'sample_meeting_test',
            title: '에스엠월드 스마트팩토리 시스템 구축 회의 (샘플 테스트)',
            agenda: '1. 센서 데이터 연동 규격 2. 50ms 미만 지연시간 보장 3. PoC 일정',
            audioUrl: '/recordings/sample_meeting.wav',
            duration: Math.round(whisperResult.duration || 30),
            dialogues: dialogues
          },
          audioUrl: '/recordings/sample_meeting.wav',
          duration: Math.round(whisperResult.duration || 30),
          dialogues: dialogues,
          transcript: whisperResult.full_transcript
        }));
      } catch (err) {
        console.error('[Sample Test Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 8. Direct YouTube URL Download & Transcription (yt-dlp)
    if (method === 'POST' && pathname === '/api/youtube-transcribe') {
      try {
        const body = await parseJsonBody(req);
        const { url, model, language, num_speakers } = body;
        if (!url || !url.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '유튜브 URL 링크를 입력해 주세요.' }));
          return;
        }

        console.log(`[YouTube API] Downloading and transcribing: ${url} (num_speakers=${num_speakers})`);
        const result = await runWhisper({
          action: 'youtube',
          url: url.trim(),
          output_dir: RECORDINGS_DIR,
          model: model || 'base',
          language: language || 'ko',
          num_speakers: num_speakers ? parseInt(num_speakers, 10) : null
        });

        if (result.error) {
          throw new Error(result.error);
        }

        const dialogues = (result.segments || []).map(seg => ({
          time: seg.time,
          start_seconds: seg.start_seconds,
          end_seconds: seg.end_seconds,
          speaker: seg.speaker,
          originalSpeaker: seg.speaker,
          text: seg.text
        }));

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          title: result.title || '유튜브 영상 전사',
          duration: Math.round(result.duration || 0),
          audioUrl: `/recordings/${result.audio_file}`,
          dialogues: dialogues,
          transcript: result.full_transcript,
          thumbnail: result.thumbnail,
          channel: result.channel
        }));
      } catch (err) {
        console.error('[YouTube API Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '유튜브 전사 중 오류가 발생했습니다: ' + err.message }));
      }
      return;
    }

    // 9. Fast Real-Time Live Chunk Transcription (Receives 16kHz WAV from Web Audio API)
    if (method === 'POST' && pathname === '/api/stream-chunk') {
      const tempFilename = `chunk_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`;
      const tempPath = path.join(RECORDINGS_DIR, tempFilename);
      const prevText = decodeURIComponent(req.headers['x-previous-text'] || '');

      const writeStream = fs.createWriteStream(tempPath);
      req.pipe(writeStream);

      writeStream.on('finish', async () => {
        try {
          const result = await runWhisper({
            action: 'transcribe',
            audio_path: tempPath,
            language: 'ko',
            model: 'base',
            beam_size: 1,
            initial_prompt: prevText || undefined
          });

          // Delete temporary chunk
          try { fs.unlinkSync(tempPath); } catch (_) {}

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (e) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ segments: [], full_transcript: '' }));
        }
      });

      writeStream.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // 9.5 AI Speaker Diarization Refiner (Re-evaluates conversational turns, honorifics, and pitch jumps)
    if (method === 'POST' && pathname === '/api/refine-diarization') {
      try {
        const body = await parseJsonBody(req);
        const { dialogues, numSpeakers } = body;
        if (!dialogues || !dialogues.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '대화 목록이 비어 있습니다.' }));
          return;
        }

        const maxK = numSpeakers && numSpeakers > 1 ? parseInt(numSpeakers, 10) : 3;

        // Rule-based high-accuracy turn alternating engine
        const refined = [];
        let currentSpkNum = 1;
        for (let i = 0; i < dialogues.length; i++) {
          const d = dialogues[i];
          const prev = i > 0 ? dialogues[i - 1] : null;

          if (prev) {
            const prevText = (prev.text || '').trim();
            const curText = (d.text || '').trim();
            const timeGap = (d.start_seconds || 0) - (prev.end_seconds || 0);

            const isQuestionTurn = /[?？]$/.test(prevText);
            const isResponseTurn = /^(네|아니|오빠|맞아|그래|근데|글쎄|저기|그렇|아\s|어\s|나도)/.test(curText);
            const isSentenceEnd = /[.!?]$/.test(prevText);
            const isPitchJump = (d.pitch && prev.pitch) ? Math.abs(d.pitch - prev.pitch) > 35 : false;

            // Trigger speaker turn if conversational cue or noticeable pause
            if (isQuestionTurn || isResponseTurn || isPitchJump || (isSentenceEnd && timeGap > 0.6) || timeGap > 1.2) {
              currentSpkNum = (currentSpkNum % maxK) + 1;
            }
          }

          refined.push({
            ...d,
            speaker: `화자 ${currentSpkNum}`,
            originalSpeaker: `화자 ${currentSpkNum}`
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, dialogues: refined }));
      } catch (err) {
        console.error('[Refine Diarization Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 10. Legacy Upload Audio (Base64)
    if (method === 'POST' && pathname === '/api/upload-audio') {
      try {
        const body = await parseJsonBody(req);
        const { meetingId, audioBase64, format } = body;
        const ext = format || 'webm';
        const filename = `${meetingId || 'rec_' + Date.now()}.${ext}`;
        const filePath = path.join(RECORDINGS_DIR, filename);

        const buffer = Buffer.from(audioBase64, 'base64');
        fs.writeFileSync(filePath, buffer);

        // Also transcribe recorded audio with Whisper!
        let whisperResult = null;
        try {
          whisperResult = await runWhisper(filePath, 'ko', 'base');
        } catch (e) {
          console.warn('Whisper on recorded audio error:', e.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          audioUrl: `/recordings/${filename}`,
          filename,
          whisperResult
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 9. Serve Audio Files with Range Support
    if (method === 'GET' && pathname.startsWith('/recordings/')) {
      const filename = path.basename(pathname);
      const filePath = path.join(RECORDINGS_DIR, filename);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          let end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

          if (isNaN(start) || start < 0 || start >= stat.size) {
            res.writeHead(416, {
              'Content-Range': `bytes */${stat.size}`,
              'Content-Type': 'text/plain'
            });
            res.end('Requested range not satisfiable');
            return;
          }

          if (isNaN(end) || end >= stat.size || end < start) {
            end = stat.size - 1;
          }

          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(filePath, { start, end });
          file.on('error', (err) => {
            console.warn('Audio stream error:', err);
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
          });
          file.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes'
          });
          const file = fs.createReadStream(filePath);
          file.on('error', (err) => {
            console.warn('Audio stream error:', err);
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          file.pipe(res);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Recording not found');
      }
      return;
    }

    // 10. Export Markdown
    if (method === 'GET' && pathname.endsWith('/export/markdown')) {
      const id = pathname.split('/')[3];
      const filePath = path.join(DATA_DIR, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const meeting = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const md = meetingToMarkdown(meeting);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(meeting.title || 'meeting')}.md"`
        });
        res.end(md);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
      return;
    }

    // --- Serve Static Frontend Files ---
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const staticFilePath = path.join(PUBLIC_DIR, safePath);

    if (fs.existsSync(staticFilePath) && fs.statSync(staticFilePath).isFile()) {
      const ext = path.extname(staticFilePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(staticFilePath).pipe(res);
    } else {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
    }
  } catch (err) {
    console.error('Unhandled request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✨ Notion AI 회의 노트 시스템이 정상 실행되었습니다!`);
  console.log(`🔗 브라우저 접속 주소: http://localhost:${PORT}`);
  console.log(`📁 회의록 저장 위치: ${DATA_DIR}`);
  console.log(`🎙️ 녹음 파일 저장 위치: ${RECORDINGS_DIR}`);
  console.log(`======================================================\n`);
});
