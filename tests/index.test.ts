import assert from "node:assert/strict";
import { test } from "node:test";
import autoTabName, { MAX_LABEL_CHARS, shortLabel, type HerdrRun } from "../src/index.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => void;
type Entry = { type: string; message: { role: string; content: unknown } };

interface Options {
  label?: string;
  sessionName?: string;
  branch?: Entry[];
  env?: Record<string, string>;
  run?: HerdrRun;
}

function harness({ label = "1", sessionName, branch = [], env = { HERDR_PANE_ID: "w1:p1" }, run }: Options = {}) {
  const saved = { HERDR_PANE_ID: process.env.HERDR_PANE_ID, PI_SUBAGENT_ID: process.env.PI_SUBAGENT_ID };
  delete process.env.HERDR_PANE_ID;
  delete process.env.PI_SUBAGENT_ID;
  Object.assign(process.env, env);
  const state = { label, renames: [] as string[] };
  const fakeRun: HerdrRun = async (args) => {
    const [kind, verb, id, ...rest] = args;
    if (kind === "pane" && verb === "get") return JSON.stringify({ result: { pane: { pane_id: id, tab_id: "w1:t1" } } });
    if (kind === "tab" && verb === "get") return JSON.stringify({ result: { tab: { tab_id: id, label: state.label } } });
    if (kind === "tab" && verb === "rename") {
      state.label = rest.join(" ");
      state.renames.push(state.label);
      return "";
    }
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  const handlers = new Map<string, Handler>();
  const pi = { on: (event: string, handler: Handler) => handlers.set(event, handler), getSessionName: () => sessionName };
  autoTabName(pi as never, run ?? fakeRun);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const ctx = { sessionManager: { getBranch: () => branch } };
  const fire = async (event: string, payload: Record<string, unknown> = {}) => {
    handlers.get(event)?.(payload, ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { state, handlers, fire };
}

const user = (content: unknown): Entry => ({ type: "message", message: { role: "user", content } });

test("shortLabel collapses whitespace and truncates by character", () => {
  assert.equal(shortLabel("  fix   the\nparser "), "fix the parser");
  const long = "pi 有辦法 herdr 加上 auto tab name 嗎";
  assert.equal(shortLabel(long), `${Array.from(long).slice(0, MAX_LABEL_CHARS).join("").trimEnd()}…`);
});

test("the first prompt names a numbered tab", async () => {
  const h = harness();
  await h.fire("session_start");
  assert.deepEqual(h.state.renames, [], "no name and no message leaves the tab alone");
  await h.fire("before_agent_start", { prompt: "權限遷移" });
  assert.deepEqual(h.state.renames, ["權限遷移"]);
});

test("the first user message wins over later prompts", async () => {
  const h = harness({ branch: [user([{ type: "text", text: "修 PDF 縮圖" }])] });
  await h.fire("before_agent_start", { prompt: "later prompt" });
  assert.deepEqual(h.state.renames, ["修 PDF 縮圖"]);
});

test("a session name wins over the first message", async () => {
  const h = harness({ sessionName: "mp-3464", branch: [user("ignored")] });
  await h.fire("session_start");
  assert.deepEqual(h.state.renames, ["mp-3464"]);
});

test("a label this session set follows session renames", async () => {
  const h = harness({ branch: [user("first task")] });
  await h.fire("session_start");
  await h.fire("session_info_changed", { name: "renamed" });
  assert.deepEqual(h.state.renames, ["first task", "renamed"]);
  await h.fire("session_info_changed", { name: undefined });
  assert.equal(h.state.label, "first task", "clearing the name falls back to the first message");
});

test("a tab named by someone else is left alone", async () => {
  const h = harness({ label: "Agents", branch: [user("task")] });
  await h.fire("session_start");
  assert.deepEqual(h.state.renames, []);
});

test("a manual rename after ours is respected", async () => {
  const h = harness({ branch: [user("task")] });
  await h.fire("session_start");
  h.state.label = "my tab";
  await h.fire("session_info_changed", { name: "new name" });
  assert.equal(h.state.label, "my tab");
});

test("nothing registers in a subagent or outside Herdr", () => {
  assert.equal(harness({ env: { HERDR_PANE_ID: "w1:p1", PI_SUBAGENT_ID: "abc" } }).handlers.size, 0);
  assert.equal(harness({ env: {} }).handlers.size, 0);
});

test("a herdr failure is swallowed after one attempt", async () => {
  let calls = 0;
  const h = harness({ sessionName: "x", run: async () => { calls++; throw new Error("herdr down"); } });
  await h.fire("session_start");
  assert.equal(calls, 1);
});
