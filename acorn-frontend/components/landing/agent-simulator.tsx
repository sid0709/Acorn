"use client";

import { useEffect, useRef, useState } from "react";
import { BURST_EVENT, type BurstDetail } from "./acorn-cursor-fx";
import {
  NEXT_JOB_DELAY_MS,
  SAMPLE_ANSWERS,
  SAMPLE_JOBS,
  SAMPLE_STEPS,
  TYPE_INTERVAL_MS,
} from "./simulator-data";

const BURST_COUNT = 25;

/** The agent window: jobs come in, and the agent types the answer to each screening question. */
export function AgentSimulator() {
  const [jobIndex, setJobIndex] = useState(0);
  // The text typed so far, with the job it belongs to: a new job shows nothing until it types.
  const [typed, setTyped] = useState({ job: 0, text: "" });
  const box = useRef<HTMLDivElement>(null);
  const answer = SAMPLE_ANSWERS[jobIndex];

  useEffect(() => {
    let count = 0;
    let next: ReturnType<typeof setTimeout> | undefined;
    const typing = setInterval(() => {
      count += 1;
      setTyped({ job: jobIndex, text: answer.answer.slice(0, count) });
      if (count < answer.answer.length) return;
      clearInterval(typing);
      const rect = box.current?.getBoundingClientRect();
      if (rect) {
        const detail: BurstDetail = { x: rect.right, y: rect.bottom, count: BURST_COUNT };
        window.dispatchEvent(new CustomEvent(BURST_EVENT, { detail }));
      }
      next = setTimeout(
        () => setJobIndex((i) => (i + 1) % SAMPLE_ANSWERS.length),
        NEXT_JOB_DELAY_MS,
      );
    }, TYPE_INTERVAL_MS);
    return () => {
      clearInterval(typing);
      clearTimeout(next);
    };
  }, [answer, jobIndex]);

  return (
    <div className="ac-sim-wrap" id="agent-demo">
      <div className="ac-sim">
        <div className="ac-sim-side">
          <div className="ac-sim-head">
            <span className="ac-sim-title">Live feed</span>
            <span className="ac-status">
              <span className="ac-dot" />
              SAMPLE RUN
            </span>
          </div>
          <div className="ac-queue">
            {SAMPLE_JOBS.map((job, index) => (
              <div
                key={job.id}
                className={index === jobIndex ? "ac-queue-item ac-queue-active" : "ac-queue-item"}
              >
                <div className="ac-queue-title">{job.title}</div>
                <div className="ac-queue-meta">
                  <span>{job.where}</span>
                  <span className="ac-queue-match">{job.match}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="ac-sim-main">
          <div>
            <div className="ac-step-tag">{"// SCREENING QUESTION"}</div>
            <div className="ac-flow">
              {SAMPLE_STEPS.map((step, index) => (
                <div key={step.title} className="ac-flow-step">
                  <span className="ac-flow-icon">{index + 1}</span>
                  <div>
                    <h4>{step.title}</h4>
                    <p>{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="ac-proposal" ref={box}>
              <div className="ac-proposal-q">{answer.question}</div>
              <span>{typed.job === jobIndex ? typed.text : ""}</span>
              <span className="ac-typing" />
            </div>
          </div>
          <div className="ac-sim-foot">
            <span className="ac-pill">Every field filled from your profile</span>
            <span className="ac-ok">✓ Form fields auto-completed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
