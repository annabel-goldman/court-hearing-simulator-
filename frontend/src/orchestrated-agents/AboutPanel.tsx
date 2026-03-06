import { useState } from 'react';
import './about-panel.css';

export function AboutPanel() {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`oa-about${collapsed ? ' oa-about--collapsed' : ''}`}>
      <button className="oa-about__toggle" onClick={() => setCollapsed(c => !c)}>
        <span className="oa-about__toggle-label">How this simulator works</span>
        <span className="oa-about__chevron">{collapsed ? '▶' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="oa-about__body">
          <div className="oa-about__grid">

            {/* ── What it is ── */}
            <section className="oa-about__section">
              <h3 className="oa-about__heading">What is this?</h3>
              <p className="oa-about__text">
                A real-time moot court simulator. You argue a case before a panel of AI judges who
                interrupt with questions, challenge weak points, and score your performance — exactly
                as they would in a live appellate hearing. Opposing counsel rebuts your arguments
                between your turns.
              </p>
            </section>

            {/* ── Workflow ── */}
            <section className="oa-about__section">
              <h3 className="oa-about__heading">Workflow</h3>
              <ol className="oa-about__steps">
                <li><span className="oa-about__step-num">1</span><span>Upload your brief — and the opposing brief if you have it.</span></li>
                <li><span className="oa-about__step-num">2</span><span>Click <strong>Start</strong> to generate the hearing agenda. The AI extracts the key legal issues and builds a topic plan for each judge.</span></li>
                <li><span className="oa-about__step-num">3</span><span>Optionally configure judge personalities, scoring weights, and opponent aggressiveness in the panels above.</span></li>
                <li><span className="oa-about__step-num">4</span><span>Click <strong>Start Hearing</strong>. The Chief Justice opens court and you begin arguing.</span></li>
                <li><span className="oa-about__step-num">5</span><span>Speak your argument. Judges will interrupt with questions; opposing counsel responds after each of your turns.</span></li>
                <li><span className="oa-about__step-num">6</span><span>Review your scores and trajectory coverage. Repeat until you're ready for the real thing.</span></li>
              </ol>
            </section>

            {/* ── Live panels ── */}
            <section className="oa-about__section">
              <h3 className="oa-about__heading">What you see during the hearing</h3>
              <ul className="oa-about__list">
                <li><strong>Agenda &amp; Coverage</strong> — which topics you've addressed and how confidently, updated in real time.</li>
                <li><strong>MCTS Tree</strong> — a live prediction of which topics the panel is likely to probe next, based on your trajectory.</li>
                <li><strong>Judge Activity</strong> — the question the panel selected, plus what every judge was thinking about asking.</li>
                <li><strong>Opposing Counsel</strong> — real-time rebuttals drawn from the opposing brief. Strategy notes explain the tactic used.</li>
                <li><strong>Argument Scores</strong> — clarity, legal reasoning, responsiveness, and persuasiveness scored after each flush.</li>
              </ul>
            </section>

            {/* ── Tips ── */}
            <section className="oa-about__section">
              <h3 className="oa-about__heading">Tips</h3>
              <ul className="oa-about__list">
                <li>Speak in complete sentences — the buffer flushes on sentence boundaries or after 3 seconds of silence.</li>
                <li>Upload the opposing brief for realistic rebuttal; without it opposing counsel only has generic counter-arguments.</li>
                <li>Mute individual judges using the toggle chips below the transcript to focus the panel.</li>
                <li>Judges need at least 10 words of transcript before they can interrupt; the agenda requires 40+ words before MCTS activates.</li>
                <li>Use the Judge Config panel to tune scoring dimensions and point the simulator at an external LLM (OpenAI, Groq, OpenRouter).</li>
                <li>TTS audio requires a real API key set via the <code>TTS_API_KEY</code> environment variable on the server.</li>
              </ul>
            </section>

          </div>
        </div>
      )}
    </div>
  );
}
