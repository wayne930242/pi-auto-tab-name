import assert from "node:assert/strict";
import { test } from "node:test";
import autoTabName, { cleanTitle, MAX_LABEL_CHARS, pickTitleModel, shortLabel, TITLE_ENTRY, type Config, type HerdrRun } from "../src/index.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => void;
type Entry = { type: string; message?: { role: string; content: unknown }; customType?: string; data?: unknown };

interface Options {
  label?: string;
  sessionName?: string;
  branch?: Entry[];
  env?: Record<string, string>;
  run?: HerdrRun;
  config?: Config;
  registry?: Record<string, unknown>;
  model?: FakeModel;
  tabPanes?: string[];
}

type FakeModel = { provider: string; id: string };

function harness({ label = "1", sessionName, branch = [], env = { HERDR_PANE_ID: "w1:p1" }, run, config = { title: false }, registry = {}, model, tabPanes = ["w1:p1"] }: Options = {}) {
  const saved = { HERDR_PANE_ID: process.env.HERDR_PANE_ID, PI_SUBAGENT_ID: process.env.PI_SUBAGENT_ID };
  delete process.env.HERDR_PANE_ID;
  delete process.env.PI_SUBAGENT_ID;
  Object.assign(process.env, env);
  const state = { label, renames: [] as string[] };
  const fakeRun: HerdrRun = async (args) => {
    const [kind, verb, id, ...rest] = args;
    if (kind === "pane" && verb === "layout") {
      assert.deepEqual(args, ["pane", "layout", "--pane", "w1:p1"]);
      return JSON.stringify({ result: { layout: { tab_id: "w1:t1", panes: tabPanes.map((pane_id) => ({ pane_id })) } } });
    }
    if (kind === "tab" && verb === "get") return JSON.stringify({ result: { tab: { tab_id: id, label: state.label } } });
    if (kind === "tab" && verb === "rename") {
      state.label = rest.join(" ");
      state.renames.push(state.label);
      return "";
    }
    throw new Error(`unexpected ${args.join(" ")}`);
  };
  const handlers = new Map<string, Handler>();
  const ctx = { sessionManager: { getBranch: () => branch }, modelRegistry: registry, model };
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    getSessionName: () => sessionName,
    appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
    setSessionName: (name: string) => {
      sessionName = name;
      handlers.get("session_info_changed")?.({ name }, ctx);
    },
  };
  autoTabName(pi as never, run ?? fakeRun, config);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const fire = async (event: string, payload: Record<string, unknown> = {}) => {
    handlers.get(event)?.(payload, ctx);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };
  return { state, handlers, fire, sessionName: () => sessionName };
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

const AVAILABLE: FakeModel[] = [
  { provider: "claude-bridge", id: "claude-opus-5-5" },
  { provider: "claude-bridge", id: "claude-haiku-4-5" },
  { provider: "claude-bridge", id: "claude-haiku-5-5" },
  { provider: "claude-bridge", id: "claude-200k-haiku-5-5" },
  { provider: "openai", id: "gpt-6-sol" },
  { provider: "openai", id: "gpt-5.6-luna" },
  { provider: "openai", id: "gpt-6-luna" },
];
const pickCtx = (model: FakeModel | undefined, available = AVAILABLE) =>
  ({ model, modelRegistry: { getAvailable: () => available } }) as never;
const id = (model: FakeModel | undefined) => (model ? `${model.provider}/${model.id}` : undefined);

test("the title model is the newest small model on the session's provider", () => {
  assert.equal(id(pickTitleModel(pickCtx(AVAILABLE[0]))), "claude-bridge/claude-haiku-5-5");
  assert.equal(id(pickTitleModel(pickCtx(AVAILABLE[4]))), "openai/gpt-6-luna");
});

test("another provider's small model, then the session model, stand in", () => {
  const session = { provider: "local", id: "big" };
  assert.equal(id(pickTitleModel(pickCtx(session, [session, AVAILABLE[6]!]))), "openai/gpt-6-luna");
  assert.equal(id(pickTitleModel(pickCtx(session, [session]))), "local/big");
});

test("a configured model wins when available, and session forces the session model", () => {
  assert.equal(id(pickTitleModel(pickCtx(AVAILABLE[0]), "openai/gpt-6-sol")), "openai/gpt-6-sol");
  assert.equal(id(pickTitleModel(pickCtx(AVAILABLE[0]), "openai/missing")), "claude-bridge/claude-haiku-5-5");
  assert.equal(id(pickTitleModel(pickCtx(AVAILABLE[0]), "session")), "claude-bridge/claude-opus-5-5");
});

test("cleanTitle keeps the first line without quotes or trailing punctuation", () => {
  assert.equal(cleanTitle('  "Fix The Parser."\nextra'), "Fix The Parser");
  assert.equal(cleanTitle("「Herdr 分頁命名」。"), "Herdr 分頁命名");
});

const reply = (text: string, stopReason = "stop") => ({ content: [{ type: "text", text }], stopReason });

test("a generated title becomes the session name and the tab label", async () => {
  const calls: string[] = [];
  const registry = {
    getAvailable: () => AVAILABLE,
    complete: async (model: FakeModel) => {
      calls.push(id(model)!);
      return reply("Herdr 分頁命名");
    },
  };
  const h = harness({ config: {}, registry, model: AVAILABLE[0] });
  await h.fire("before_agent_start", { prompt: "pi 有辦法 herdr 加上 auto tab name 嗎" });
  assert.equal(h.sessionName(), "Herdr 分頁命名");
  assert.deepEqual(h.state.renames, [shortLabel("pi 有辦法 herdr 加上 auto tab name 嗎"), "Herdr 分頁命名"]);
  await h.fire("before_agent_start", { prompt: "second prompt" });
  assert.deepEqual(calls, ["claude-bridge/claude-haiku-5-5"], "one title call per session");
});

test("a failed title call leaves the truncated prompt", async () => {
  for (const complete of [async () => reply("", "error"), async () => { throw new Error("offline"); }]) {
    const h = harness({ config: {}, registry: { getAvailable: () => AVAILABLE, complete }, model: AVAILABLE[0] });
    await h.fire("before_agent_start", { prompt: "權限遷移" });
    assert.equal(h.sessionName(), undefined);
    assert.deepEqual(h.state.renames, ["權限遷移"]);
  }
});

test("a named session or title: false makes no title call", async () => {
  let calls = 0;
  const registry = { getAvailable: () => AVAILABLE, complete: async () => { calls++; return reply("x"); } };
  await harness({ config: {}, registry, model: AVAILABLE[0], sessionName: "named" }).fire("before_agent_start", { prompt: "p" });
  await harness({ config: { title: false }, registry, model: AVAILABLE[0] }).fire("before_agent_start", { prompt: "p" });
  assert.equal(calls, 0);
});

test("a title that lands after /new is dropped", async () => {
  let resolve: (value: unknown) => void = () => {};
  const registry = { getAvailable: () => AVAILABLE, complete: () => new Promise((r) => { resolve = r; }) };
  const h = harness({ config: {}, registry, model: AVAILABLE[0] });
  await h.fire("before_agent_start", { prompt: "old task" });
  await h.fire("session_start");
  resolve(reply("Old Title"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.sessionName(), undefined);
});

test("only the tab's first pane names it", async () => {
  const h = harness({ branch: [user("worker task")], tabPanes: ["w1:p2Z", "w1:p1"] });
  await h.fire("session_start");
  assert.deepEqual(h.state.renames, []);
});

test("a restarted session takes back a tab that still shows its label", async () => {
  const h = harness({ label: "mp-3464", sessionName: "mp-3464" });
  await h.fire("session_start");
  h.handlers.get("session_info_changed")?.({ name: "mp-3465" }, { sessionManager: { getBranch: () => [] } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.state.label, "mp-3465");
});

const summaryRegistry = (titles: string[], calls: string[] = []) => ({
  getAvailable: () => AVAILABLE,
  complete: async (_model: FakeModel, context: { messages: { content: string }[] }) => {
    calls.push(context.messages[0]!.content);
    return reply(titles.shift() ?? "");
  },
});
const compact = (summary: string) => ({ compactionEntry: { summary } });

test("a compaction renames a generated title from its summary", async () => {
  const calls: string[] = [];
  const h = harness({ config: {}, registry: summaryRegistry(["First Title", "Second Title"], calls), model: AVAILABLE[0] });
  await h.fire("before_agent_start", { prompt: "first task" });
  assert.equal(h.sessionName(), "First Title");
  await h.fire("session_compact", compact("## Goal\nnow deploying"));
  assert.equal(h.sessionName(), "Second Title");
  assert.equal(h.state.label, "Second Title");
  assert.match(calls[1]!, /<summary>\n## Goal\nnow deploying\n<\/summary>/);
});

test("a compaction keeps a name the user chose", async () => {
  const calls: string[] = [];
  const h = harness({ config: {}, registry: summaryRegistry(["Generated"], calls), model: AVAILABLE[0], sessionName: "my name" });
  await h.fire("session_start");
  await h.fire("session_compact", compact("summary"));
  assert.equal(h.sessionName(), "my name");
  assert.equal(calls.length, 0);
});

test("a resumed session recognizes its generated name and an unnamed one gets a title", async () => {
  let h = harness({
    config: {},
    registry: summaryRegistry(["Resumed Title"]),
    model: AVAILABLE[0],
    sessionName: "Old Title",
    branch: [{ type: "custom", customType: TITLE_ENTRY, data: { name: "Old Title" } }],
  });
  await h.fire("session_start");
  await h.fire("session_compact", compact("summary"));
  assert.equal(h.sessionName(), "Resumed Title");
  h = harness({ config: {}, registry: summaryRegistry(["Fresh Title"]), model: AVAILABLE[0] });
  await h.fire("session_compact", compact("summary"));
  assert.equal(h.sessionName(), "Fresh Title");
});
