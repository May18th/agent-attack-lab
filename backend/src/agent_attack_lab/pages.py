"""HTML page templates for the built-in admin UI.

Pure string formatting: no state, no I/O, no request objects. Route logic
(auth checks, redirects, cache headers) lives in ``routers/``.
"""

from __future__ import annotations


def dashboard_html(*, topic_value: str, selected_difficulty: str) -> str:
    return (
        """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>智能体攻防实验室后台</title>
  <style>
    :root { color-scheme: light; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f5; color: #17202a; }
    header { background: #fff; border-bottom: 1px solid #d8e0e5; }
    .topbar { max-width: 1180px; margin: 0 auto; padding: 22px 24px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    h1 { margin: 0 0 6px; font-size: 27px; letter-spacing: .2px; }
    .sub { margin: 0; color: #65727d; font-size: 14px; }
    .status { display: flex; align-items: center; gap: 9px; color: #53616d; font-size: 13px; white-space: nowrap; padding-top: 7px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #c0392b; }
    .dot.ok { background: #1f9d55; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; }
    .layout { display: grid; grid-template-columns: minmax(290px, .82fr) minmax(0, 1.45fr); gap: 18px; align-items: start; }
    .panel { background: #fff; border: 1px solid #d8e0e5; border-radius: 8px; padding: 20px; }
    .panel + .panel { margin-top: 18px; }
    .panel-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 16px; }
    .panel-title h2 { margin: 0; font-size: 17px; }
    .panel-title span { color: #74808a; font-size: 12px; }
    label { display: block; margin: 0 0 7px; color: #52606c; font-size: 13px; }
    input[type=text] { width: 100%; border: 1px solid #cbd5dc; border-radius: 6px; padding: 10px 11px; color: #17202a; font: inherit; outline: none; }
    input[type=text]:focus { border-color: #2878c8; box-shadow: 0 0 0 3px #2878c81c; }
    .field { margin-bottom: 18px; }
    .choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .choices input { position: absolute; opacity: 0; pointer-events: none; }
    .choices label { margin: 0; border: 1px solid #cbd5dc; border-radius: 6px; padding: 10px 8px; text-align: center; cursor: pointer; color: #45535f; }
    .choices input:checked + label { border-color: #2878c8; color: #125a9d; background: #edf6ff; }
    button { border: 0; border-radius: 6px; padding: 11px 16px; background: #1769aa; color: #fff; font: inherit; font-weight: 600; cursor: pointer; width: 100%; }
    button:hover { background: #12558b; }
    button:disabled { cursor: wait; opacity: .65; }
    .hint { margin: 10px 0 0; color: #77838d; font-size: 12px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-bottom: 18px; }
    .metric { border-left: 3px solid #2878c8; padding: 10px 12px; background: #f5f8fa; }
    .metric b { display: block; font-size: 22px; line-height: 1.1; }
    .metric span { display: block; margin-top: 4px; color: #687580; font-size: 12px; }
    .result { min-height: 238px; border: 1px dashed #cbd5dc; border-radius: 6px; padding: 15px; background: #fbfcfd; }
    .empty { color: #7a8790; text-align: center; padding: 78px 12px; font-size: 14px; }
    .battle-head { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid #e4eaee; }
    .battle-head strong { font-size: 15px; }
    .battle-head span { color: #667580; font-size: 12px; }
    .flow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 18px; }
    .flow-step { position: relative; min-height: 64px; padding: 10px 10px 8px 36px; border: 1px solid #dce5ea; border-radius: 6px; background: #f7fafb; }
    .flow-step:not(:last-child)::after { content: ""; position: absolute; top: 28px; right: -9px; width: 10px; border-top: 1px solid #a9bbc7; z-index: 1; }
    .flow-step i { position: absolute; left: 10px; top: 11px; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: #1769aa; color: #fff; font-style: normal; font-size: 11px; font-weight: 700; }
    .flow-step b { display: block; font-size: 12px; }
    .flow-step small { display: block; margin-top: 4px; color: #75818a; font-size: 11px; }
    .battle-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .summary-item { padding: 9px 10px; border-radius: 5px; background: #f5f8fa; text-align: center; }
    .summary-item b { display: block; font-size: 18px; }
    .summary-item span { color: #71808a; font-size: 11px; }
    .round-list { display: grid; gap: 12px; }
    .round { border: 1px solid #dce5ea; border-radius: 7px; overflow: hidden; background: #fff; }
    .round-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f5f8fa; border-bottom: 1px solid #e4eaee; }
    .round-number { color: #1769aa; font-weight: 700; font-size: 12px; }
    .round-type { padding: 2px 6px; border-radius: 3px; background: #fff0da; color: #a46111; font-size: 11px; }
    .round-state { margin-left: auto; color: #1f8050; font-size: 11px; }
    .round-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
    .round-grid h3 { margin: 0 0 7px; font-size: 12px; color: #52606c; }
    .attack-box, .defend-box { min-width: 0; padding: 10px; border-radius: 5px; font-size: 12px; line-height: 1.5; }
    .attack-box { border-left: 3px solid #e08b2c; background: #fff8ed; }
    .defend-box { border-left: 3px solid #1f9d55; background: #effaf3; }
    .round-content { margin-top: 6px; overflow-wrap: anywhere; color: #374650; }
    .result-list { margin: 5px 0 0; padding-left: 17px; color: #43535d; }
    .result-list li { margin: 2px 0; }
    .result-label { margin-top: 9px; color: #71808a; font-size: 11px; }
    .muted { color: #89959d; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #e7ecef; text-align: left; white-space: nowrap; }
    th { color: #667580; font-size: 12px; font-weight: 600; }
    td:last-child { text-align: right; }
    a { color: #1769aa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .error { color: #b42318; background: #fff1f0; border: 1px solid #f2c4bf; border-radius: 6px; padding: 10px; font-size: 13px; }
    @media (max-width: 760px) { .topbar { display: block; } .status { margin-top: 14px; } .layout { grid-template-columns: 1fr; } .round-grid { grid-template-columns: 1fr; } .flow { grid-template-columns: repeat(2, 1fr); } .flow-step:not(:last-child)::after { display: none; } .battle-summary { grid-template-columns: repeat(2, 1fr); } main { padding: 16px; } }

    /* Visual system: a focused operations console instead of a default form page. */
    :root { color-scheme: dark; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
    body { background: #080d18; color: #e7edf5; background-image: linear-gradient(135deg, #0d1728 0%, #080d18 48%, #111729 100%); }
    header { background: #0d1525e8; border-bottom: 1px solid #26354c; box-shadow: 0 12px 30px #02050b66; }
    .topbar { max-width: 1320px; padding: 30px 28px 26px; }
    h1 { font-size: 30px; letter-spacing: .4px; color: #f3f7fb; }
    .sub { color: #91a2b8; font-size: 13px; }
    .status { color: #a6b5c8; padding: 9px 13px; border: 1px solid #2b415b; border-radius: 999px; background: #111e31; box-shadow: inset 0 1px #ffffff08; }
    .dot { box-shadow: 0 0 0 4px #e0525220; }
    .dot.ok { box-shadow: 0 0 0 4px #32d29620; }
    main { max-width: 1320px; padding: 28px; }
    .layout { grid-template-columns: minmax(310px, .74fr) minmax(0, 1.7fr); gap: 20px; }
    .panel { background: #111a2b; border: 1px solid #26364d; border-radius: 12px; padding: 22px; box-shadow: 0 18px 45px #02050b55, inset 0 1px #ffffff08; }
    .panel + .panel { margin-top: 20px; }
    .panel-title { margin-bottom: 20px; }
    .panel-title h2 { color: #f1f5fa; font-size: 18px; }
    .panel-title span { color: #7f91a8; }
    label { color: #aebdce; }
    input[type=text] { border-color: #30445d; background: #0b1322; color: #edf4fb; border-radius: 8px; padding: 12px 13px; }
    input[type=text]:focus { border-color: #49d1b7; box-shadow: 0 0 0 3px #49d1b71f; }
    .field { margin-bottom: 21px; }
    .choices { gap: 10px; }
    .choices label { border-color: #30445d; background: #0d1727; color: #9cafc2; border-radius: 9px; padding: 12px 8px; }
    .choices input:checked + label { border-color: #49d1b7; color: #d9fff6; background: #15332f; box-shadow: inset 0 0 0 1px #49d1b733; }
    button { border-radius: 9px; background: #2f9f90; box-shadow: 0 8px 18px #02060c55; }
    button:hover { background: #45b9a7; }
    .hint { color: #74869d; }
    .metrics { gap: 10px; }
    .metric { border: 1px solid #293c55; border-left: 3px solid #49d1b7; border-radius: 9px; padding: 13px 14px; background: #0d1727; }
    .metric:nth-child(2) { border-left-color: #f5b45a; }
    .metric:nth-child(3) { border-left-color: #7aa7ff; }
    .metric b { color: #f2f7fb; font-size: 24px; }
    .metric span { color: #8395aa; }
    .result { min-height: 310px; border: 1px solid #263950; border-radius: 10px; padding: 17px; background: #0c1423; }
    .empty { color: #75869a; padding: 96px 12px; }
    .battle-head { padding-bottom: 15px; border-bottom-color: #263950; }
    .battle-head strong { color: #f5f8fb; font-size: 16px; }
    .battle-head span { color: #8da0b5; }
    .flow { gap: 10px; margin: 18px 0 20px; }
    .flow-step { min-height: 74px; padding: 12px 10px 9px 40px; border-color: #2b405a; border-radius: 9px; background: #111e31; }
    .flow-step:not(:last-child)::after { border-top-color: #3a526c; }
    .flow-step i { left: 11px; top: 13px; width: 21px; height: 21px; background: #347fc2; box-shadow: 0 0 0 4px #347fc21c; }
    .flow-step b { color: #dce8f4; }
    .flow-step small { color: #8194a9; }
    .battle-summary { gap: 10px; margin-bottom: 19px; }
    .summary-item { border: 1px solid #263950; border-radius: 9px; padding: 12px 10px; background: #111e31; }
    .summary-item b { color: #f2f7fb; font-size: 20px; }
    .summary-item span { color: #8295aa; }
    .round { border-color: #2b405a; border-radius: 10px; background: #0f192a; box-shadow: 0 12px 24px #02050b33; }
    .round-head { padding: 12px 14px; background: #142238; border-bottom-color: #293d57; }
    .round-number { color: #7fd9ff; }
    .round-type { padding: 4px 8px; border-radius: 999px; background: #3a2d1b; color: #f5c475; }
    .round-state { color: #65ddb4; }
    .round-grid { gap: 14px; padding: 14px; }
    .round-grid h3 { color: #afc0d1; }
    .attack-box, .defend-box { padding: 13px; border-radius: 8px; }
    .attack-box { border-left-color: #ed9f4d; background: #251c14; }
    .defend-box { border-left-color: #49d1b7; background: #112a2a; }
    .round-content { color: #d4dee9; }
    .result-list { color: #c4d2df; }
    .result-label { color: #8397ac; }
    .muted { color: #74869a; }
    table { color: #dbe5ef; }
    th, td { border-bottom-color: #263950; }
    th { color: #8ea1b7; }
    a { color: #72dcca; }
    .error { color: #ffb7bd; background: #311b25; border-color: #71323e; }
    .event-panel { margin-top: 16px; padding: 13px 15px; border: 1px solid #263950; border-radius: 9px; background: #0a1220; }
    .event-title { display: flex; justify-content: space-between; gap: 12px; color: #dce8f4; font-size: 12px; font-weight: 700; }
    .event-title small { color: #7f94aa; font-size: 11px; font-weight: 400; }
    .live-flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
    .live-phase { min-width: 0; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 3px 8px; padding: 8px 9px; border: 1px solid #263950; border-radius: 7px; background: #101a2a; color: #71869e; }
    .live-phase i { grid-row: span 2; display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid #42546a; border-radius: 50%; font: normal 10px var(--mono); }
    .live-phase b { overflow-wrap: anywhere; color: #91a2b6; font-size: 10px; }
    .live-phase small { overflow-wrap: anywhere; color: #63758b; font-size: 9px; }
    .live-phase.active { border-color: #49d1b7a6; background: #12302d; }
    .live-phase.active i { border-color: #49d1b7; color: #8cf3da; box-shadow: 0 0 0 3px #49d1b71c; animation: phase-pulse 1.4s ease-in-out infinite; }
    .live-phase.active b { color: #dcfff7; }
    .live-phase.done { border-color: #347fc277; background: #112236; }
    .live-phase.done i { border-color: #347fc2; background: #347fc2; color: #fff; }
    .live-phase.done b { color: #c3d9ee; }
    .live-phase.failed { border-color: #ef777f; background: #311b25; }
    .live-phase.failed i, .live-phase.failed b { color: #ffb7bd; border-color: #ef777f; }
    @keyframes phase-pulse { 50% { box-shadow: 0 0 0 6px #49d1b70d; } }
    .event-log { display: grid; gap: 7px; max-height: 280px; overflow: auto; margin: 10px 0 0; padding: 0; list-style: none; }
    .event-log li { display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 9px; padding: 7px 8px; border-left: 2px solid #347fc2; background: #111e31; color: #aebed0; font-size: 11px; overflow-wrap: anywhere; }
    .event-log .event-placeholder { display: block; }
    .event-log .event-enter { animation: event-enter 240ms ease-out both; }
    @keyframes event-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
    .event-log time { color: #71869e; font-variant-numeric: tabular-nums; }
    .event-log .event-done { border-left-color: #49d1b7; }
    .event-log .event-failed { border-left-color: #ef777f; color: #ffb7bd; }
    .dialog-panel { margin-top: 14px; border: 1px solid #263950; border-radius: 9px; background: #0a1220; overflow: hidden; }
    .dialog-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #263950; color: #dce8f4; font-size: 12px; font-weight: 700; }
    .dialog-head small { color: #74869d; font-size: 10px; font-weight: 400; text-align: right; }
    .dialog-log { display: flex; flex-direction: column; gap: 12px; max-height: 480px; overflow: auto; margin: 0; padding: 14px; list-style: none; }
    .dialog-item { width: min(90%, 720px); min-width: 0; animation: event-enter 240ms ease-out both; }
    .dialog-item.attacker { align-self: flex-start; }
    .dialog-item.defender { align-self: flex-end; }
    .dialog-bubble { padding: 12px 14px; border: 1px solid #34485f; border-radius: 8px; background: #121f31; color: #c5d2e0; }
    .attacker .dialog-bubble { border-left: 3px solid #ed9f4d; background: #211b16; }
    .defender .dialog-bubble { border-right: 3px solid #49d1b7; background: #112321; }
    .dialog-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .dialog-meta b { color: #eef4fb; font-size: 12px; }
    .attacker .dialog-meta b { color: #f2c28d; }
    .defender .dialog-meta b { color: #a6efdb; }
    .dialog-meta span { color: #8194a9; font-size: 10px; text-align: right; }
    .dialog-topic { margin-bottom: 7px; color: #a9bbce; font-size: 11px; }
    .dialog-content { margin: 0; color: #f0e3d5; font: 12px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-section { margin-top: 10px; }
    .dialog-section b { color: #9cb0c4; font-size: 10px; }
    .dialog-section ul { margin: 4px 0 0; padding-left: 17px; color: #c5d2e0; font-size: 11px; }
    .dialog-section li { margin: 2px 0; overflow-wrap: anywhere; }
    .dialog-evidence { display: inline-block; margin-top: 3px; color: #8fa4ba; line-height: 1.5; }
    .recommendation-details { margin: 7px 0 2px; border: 1px solid #31445b; border-radius: 6px; padding: 7px 9px; background: #0b1422; }
    .recommendation-details summary { color: #80d9c7; cursor: pointer; font-size: 11px; }
    .recommendation-details p { margin: 7px 0 3px; color: #bdcad8; font-size: 11px; }
    .recommendation-details ol { margin: 4px 0 7px; padding-left: 20px; color: #bdcad8; font-size: 11px; }
    .recommendation-details pre { max-height: 260px; overflow: auto; margin: 5px 0; padding: 9px; border-radius: 5px; background: #070c14; color: #b9e3dc; font: 11px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .dialog-verification { margin: 8px 0 4px; padding: 7px 9px; border-left: 2px solid #edb45f; background: #2a2519; color: #f1d9a8; font-size: 10px; line-height: 1.5; }
    .dialog-scope { margin: 6px 0; color: #94a6b9; font-size: 10px; line-height: 1.5; }
    .dialog-pending, .dialog-empty { padding: 12px; color: #74869d; font-size: 11px; }
    .dialog-empty { text-align: center; }
    .dialog-raw { margin-top: 10px; border-top: 1px solid #34485f; padding-top: 8px; }
    .dialog-raw summary { color: #8499ae; cursor: pointer; font-size: 10px; }
    .dialog-raw pre { max-height: 180px; overflow: auto; margin: 7px 0 0; padding: 9px; border-radius: 5px; background: #080e18; color: #a9bed2; font: 10px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .battle-visual { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(170px, .8fr) minmax(150px, 1fr); grid-template-areas: "attacker track defender" "caption caption caption"; align-items: center; gap: 10px; padding: 14px; border-top: 1px solid #263950; border-bottom: 1px solid #263950; background: #0d1726; }
    .agent-card { min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 2px 10px; padding: 12px; border: 1px solid #2a3b50; border-radius: 8px; background: #111d2c; transition: border-color 180ms ease, background 180ms ease; }
    .agent-card.attacker { grid-area: attacker; }
    .agent-card.defender { grid-area: defender; }
    .agent-card .agent-mark { grid-row: span 2; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #56677a; border-radius: 50%; color: #b9c8d8; font: 10px var(--mono); }
    .agent-card strong { min-width: 0; color: #dce8f4; font-size: 11px; overflow-wrap: anywhere; }
    .agent-card small { min-width: 0; color: #7f94aa; font-size: 10px; overflow-wrap: anywhere; }
    .agent-card.attacker.active { border-color: #ed9f4d; background: #251d15; }
    .agent-card.attacker.active .agent-mark { border-color: #ed9f4d; color: #ffd39d; }
    .agent-card.defender.active { border-color: #49d1b7; background: #112a27; }
    .agent-card.defender.active .agent-mark { border-color: #49d1b7; color: #a6efdb; }
    .exchange-track { position: relative; grid-area: track; height: 38px; min-width: 0; }
    .exchange-track::before { position: absolute; top: 19px; left: 2%; right: 2%; height: 1px; background: #40556d; content: ""; }
    .exchange-track::after { position: absolute; top: 14px; right: 1%; width: 9px; height: 9px; border-top: 1px solid #71869e; border-right: 1px solid #71869e; transform: rotate(45deg); content: ""; }
    .exchange-packet { position: absolute; z-index: 1; top: 7px; left: 2%; max-width: 82%; padding: 4px 7px; overflow: hidden; border: 1px solid #536a82; border-radius: 5px; background: #16263a; color: #c5d5e5; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; opacity: 0; }
    .exchange-packet.outbound { animation: packet-out 650ms ease-in-out forwards; border-color: #ed9f4d; color: #ffd39d; }
    .exchange-packet.returning { animation: packet-back 650ms ease-in-out forwards; border-color: #49d1b7; color: #a6efdb; }
    @keyframes packet-out { from { left: 2%; opacity: 0; } 12% { opacity: 1; } to { left: 72%; opacity: 1; } }
    @keyframes packet-back { from { left: 72%; opacity: 0; } 12% { opacity: 1; } to { left: 2%; opacity: 1; } }
    .visual-caption { grid-area: caption; min-height: 16px; color: #8295aa; font-size: 10px; text-align: center; }
    @media (max-width: 640px) { .battle-visual { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "attacker defender" "track track" "caption caption"; } }
    .panel-title { align-items: flex-start; }
    .panel-title a { max-width: 170px; text-align: right; line-height: 1.35; }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric { min-width: 0; overflow: hidden; }
    .metric b { overflow-wrap: anywhere; word-break: break-word; }
    .metric span { overflow-wrap: anywhere; word-break: break-word; }
    #latest { font-size: 18px; line-height: 1.25; }
    table { table-layout: fixed; }
    th, td { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
    td:last-child { text-align: left; }
    th:nth-child(1), td:nth-child(1) { width: 24%; }
    th:nth-child(2), td:nth-child(2) { width: 12%; }
    th:nth-child(3), td:nth-child(3) { width: 15%; }
    th:nth-child(4), td:nth-child(4) { width: 25%; }
    th:nth-child(5), td:nth-child(5) { width: 24%; }
    @media (max-width: 980px) { .layout { grid-template-columns: 1fr; } .topbar { padding-left: 22px; padding-right: 22px; } main { padding: 22px; } }
    @media (max-width: 560px) { .metrics { grid-template-columns: 1fr; } .metric { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; } .metric span { margin-top: 0; text-align: right; } .flow { grid-template-columns: 1fr; } .live-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); } .battle-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .panel-title { display: block; } .panel-title a { display: inline-block; margin-top: 8px; text-align: left; } }
    @media (max-width: 760px) { .topbar { padding: 24px 18px 20px; } h1 { font-size: 25px; } main { padding: 18px; } .panel { padding: 18px; } }
    .topbar { align-items: center; }
    .header-meta { display: grid; justify-items: end; gap: 8px; }
    .header-meta .status { padding: 8px 12px; }
    .status-note { color: #92a6bb; font-size: 11px; text-align: right; }
    .layout { grid-template-columns: minmax(250px, .58fr) minmax(0, 1.72fr); align-items: stretch; }
    #battle-panel { border-color: #35506b; box-shadow: 0 22px 52px #02050b77, inset 0 1px #ffffff0a; }
    #history-panel { margin-top: 20px; }
    .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .metric .metric-note { display: block; margin-top: 4px; color: #8295aa; font-size: 10px; text-align: left; }
    .dialog-log { max-height: none; padding: 12px; }
    .dialog-round { min-width: 0; overflow: hidden; border: 1px solid #2b405a; border-radius: 8px; background: #0d1726; }
    .dialog-round-head { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #263950; color: #dce8f4; font-size: 11px; }
    .dialog-round-head small { color: #8295aa; font-size: 10px; }
    .dialog-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; padding: 10px; }
    .dialog-side { min-width: 0; padding: 10px; border-radius: 6px; background: #121f31; }
    .dialog-side.attacker { border-left: 2px solid #ed9f4d; background: #211b16; }
    .dialog-side.defender { border-left: 2px solid #49d1b7; background: #112321; }
    .dialog-side-title { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; color: #e5edf6; font-size: 11px; }
    .dialog-side-title small { color: #8295aa; font-size: 9px; text-align: right; }
    .dialog-side .dialog-content { font-size: 11px; }
    .replay-controls { display: grid; grid-template-columns: repeat(4, auto) minmax(80px, 1fr) auto auto; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #263950; background: #0a1220; }
    .replay-controls[hidden] { display: none; }
    .replay-controls button { width: auto; min-height: 34px; padding: 6px 10px; border: 1px solid #344b63; background: #142238; color: #dbe8f5; font-size: 11px; }
    .replay-controls button:hover:not(:disabled) { border-color: #49d1b7; background: #18332f; }
    .replay-controls button:disabled { opacity: .45; }
    .replay-controls input { min-width: 60px; width: 100%; accent-color: #49d1b7; }
    .replay-controls select { min-height: 34px; border: 1px solid #344b63; border-radius: 5px; padding: 4px 6px; background: #101a2a; color: #dbe8f5; }
    .replay-count { color: #8ea1b7; font-size: 10px; white-space: nowrap; }
    .history-open { width: auto; padding: 6px 9px; border: 1px solid #344b63; background: #142238; font-size: 11px; }
    .round-details { margin-top: 14px; border-top: 1px solid #263950; padding-top: 10px; }
    .round-details summary { color: #a6b5c8; cursor: pointer; font-size: 11px; }
    .round-details .round-list { margin-top: 10px; }
    .internal-score { margin-top: 14px; padding: 12px; border: 1px solid #304357; border-radius: 6px; background: #0d1725; }
    .internal-score h3 { margin: 0; color: #dce9f5; font-size: 13px; }
    .internal-score-note { margin: 6px 0 10px; color: #8ea1b7; font-size: 10px; line-height: 1.5; }
    .internal-score-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .internal-score-role { min-width: 0; padding: 10px; border: 1px solid #263950; border-radius: 5px; }
    .internal-score-role strong { color: #80d9c7; font-size: 12px; }
    .internal-score-role ul { margin: 8px 0 0; padding-left: 17px; color: #aebed0; font-size: 10px; line-height: 1.6; }
    #result[hidden] { display: none; }
    .history-row-active { background: #15332f; }
    @media (max-width: 760px) {
      .topbar { display: flex; align-items: flex-start; gap: 12px; }
      .header-meta { justify-items: start; }
      .status-note { text-align: left; }
      .header-meta .status { max-width: 100%; white-space: normal; }
      .status-note { max-width: 100%; overflow-wrap: anywhere; }
      .layout { width: 100%; grid-template-columns: minmax(0, 1fr); }
      .layout > section, .panel { min-width: 0; }
      .dialog-pair { grid-template-columns: minmax(0, 1fr); }
      .replay-controls { grid-template-columns: repeat(4, auto) minmax(60px, 1fr); }
      .replay-controls select { grid-column: 5; }
      .replay-count { grid-column: 1 / 5; grid-row: 2; }
      .internal-score-grid { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 480px) {
      .topbar { display: block; }
      .header-meta { margin-top: 12px; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .replay-controls { grid-template-columns: repeat(4, minmax(0, auto)); }
      .replay-controls input { grid-column: 1 / 4; grid-row: 2; }
      .replay-controls select { grid-column: 4; grid-row: 2; }
      .replay-count { grid-column: 1 / -1; grid-row: 3; }
    }
    @media (max-width: 560px) { .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  </style>
</head>
<body>
  <header><div class="topbar"><div><h1>智能体攻防实验室</h1><p class="sub">攻防战局控制台</p></div><div class="header-meta"><div class="status"><span id="dot" class="dot"></span><span id="status">正在检查服务状态……</span></div><div id="agent-source-label" class="status-note">尚未选择战局 · 来源待记录</div><div id="verification-summary" class="status-note">真实目标验证：未执行</div></div></div></header>
  <main>
    <div class="layout">
      <section>
        <div class="panel">
          <div class="panel-title"><h2>开始新战局</h2><span>攻防编排</span></div>
          <form id="battle-form">
            <div class="field"><label for="topic">测试主题</label><input id="topic" name="topic" type="text" maxlength="200" value="__INITIAL_TOPIC__" required></div>
            <div class="field"><label>对抗难度</label><div class="choices"><div><input id="low" name="difficulty" value="low" type="radio" __LOW_CHECKED__><label for="low">低</label></div><div><input id="mid" name="difficulty" value="mid" type="radio" __MID_CHECKED__><label for="mid">中</label></div><div><input id="high" name="difficulty" value="high" type="radio" __HIGH_CHECKED__><label for="high">高</label></div></div></div>
            <button id="start" type="submit">开始攻防</button><p class="hint">完成后将在右侧显示攻击样本、风险依据和处置建议。演示环境使用本地模拟用例；真实 Agent 结果会标明来源。</p>
          </form>
        </div>
      </section>
      <section id="battle-panel" class="panel">
        <div class="panel-title"><h2>当前战况</h2><span id="battle-id">尚未开始</span></div>
        <div class="event-panel">
          <div class="event-title"><span>实时过程</span><small id="event-state" aria-live="polite">等待开始</small></div>
          <div id="live-flow" class="live-flow" aria-label="实时攻防阶段">
            <div class="live-phase" data-phase="create"><i>01</i><b>战局创建</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="attack"><i>02</i><b>攻击生成</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="defense"><i>03</i><b>防守检测</b><small>等待开始</small></div>
            <div class="live-phase" data-phase="report"><i>04</i><b>结果汇总</b><small>等待开始</small></div>
          </div>
          <ol id="event-log" class="event-log" aria-live="polite"><li class="event-placeholder">创建战局后显示攻击和防守进度</li></ol>
        </div>
        <div class="dialog-panel">
          <div class="dialog-head"><span>按回合查看攻防交互</span><small>左侧样本 · 右侧检测结果</small></div>
          <div class="battle-visual" aria-label="攻击与防守数据流">
            <div id="attacker-card" class="agent-card attacker"><span class="agent-mark">攻</span><strong>攻击智能体</strong><small id="attacker-state">待命</small></div>
            <div class="exchange-track"><span id="exchange-packet" class="exchange-packet"></span></div>
            <div id="defender-card" class="agent-card defender"><span class="agent-mark">守</span><strong>防守智能体</strong><small id="defender-state">待命</small></div>
            <div id="visual-caption" class="visual-caption">等待战局开始</div>
          </div>
          <div id="replay-controls" class="replay-controls" aria-label="战局回放控制" hidden>
            <button id="replay-start" type="button" title="回到开头">开头</button>
            <button id="replay-toggle" type="button" title="播放或暂停">播放</button>
            <button id="replay-next" type="button" title="前进一个事件">下一步</button>
            <button id="replay-prev" type="button" title="后退一个事件">上一步</button>
            <input id="replay-range" type="range" min="0" max="0" value="0" aria-label="回放进度" disabled>
            <span id="replay-count" class="replay-count">0 / 0</span>
            <select id="replay-speed" aria-label="回放速度"><option value="1500">慢速</option><option value="800" selected>正常</option><option value="350">快速</option></select>
          </div>
          <ol id="dialog-log" class="dialog-log" aria-live="polite"><li class="dialog-empty">等待攻击方提交样本</li></ol>
        </div>
        <div id="result" class="result"><div class="empty">提交主题后开始一轮攻防</div></div>
      </section>
    </div>
    <section id="history-panel" class="panel">
      <div class="panel-title"><h2>已保存战局统计</h2><a href="/docs">接口文档</a></div>
      <div class="metrics">
        <div class="metric"><b id="total">0</b><span>全部战局</span></div>
        <div class="metric"><b id="completed-count">0</b><span>已完成</span></div>
        <div class="metric"><b id="failed-count">0</b><span>失败</span></div>
        <div class="metric"><b id="sample-count">0</b><span>已保存样本</span></div>
        <div class="metric"><b id="rule-hit-count">0</b><span>规则命中</span></div>
        <div class="metric"><b id="risk-count">0</b><span>风险记录</span></div>
        <div class="metric"><b id="acp-request-count">0</b><span>ACP 调用次数</span></div>
        <div class="metric"><b id="acp-outcome">0 / 0</b><span>ACP 成功 / 失败</span></div>
        <div class="metric"><b id="acp-fallback-count">0</b><span>ACP 规则兜底</span></div>
        <div class="metric"><b id="local-call-count">0</b><span>本地规则执行</span></div>
        <div class="metric"><b id="llm-result-count">0</b><span>返回声明为 LLM</span></div>
        <div class="metric"><b id="agent-latency">0</b><span>Agent 平均耗时（毫秒）</span></div>
      </div>
      <p id="saved-data-note" class="hint">统计来自已保存战局，不含准确率推断。</p>
      <div class="table-wrap"><table><thead><tr><th>主题</th><th>难度</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody id="history"><tr><td colspan="5" class="empty">暂无历史战局</td></tr></tbody></table></div>
    </section>
  </main>
  <script>
    var $ = function (id) { return document.getElementById(id); };
    function escapeHtml(value) { return String(value).replace(/[&<>\"']/g, function (char) { return ({"&":"&amp;","<":"&lt;",">":"&gt;","\\\"":"&quot;","'":"&#039;"})[char]; }); }
    function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", {hour12: false}) : "--"; }
    var activeRound = null;
    function eventLabel(type) { return ({"battle.created":"战局已创建","battle.retry":"战局已重新提交","attack.started":"攻击阶段开始","agent.call.started":"Agent 调用开始","agent.call.completed":"Agent 调用完成","agent.call.failed":"Agent 调用失败","attack.sample.generated":"攻击方提交样本","attack.completed":"攻击样本已生成","round.started":"开始检测本轮样本","round.completed":"本轮防守检测完成","defense.completed":"防守阶段完成","battle.completed":"战局完成","battle.failed":"战局失败"})[type] || type; }
    function updateLiveFlow(event) {
      if (event.type.indexOf("agent.call.") === 0) return;
      var active = 0;
      var state = "准备阶段";
      updateBattleVisual(event);
      if (event.type === "battle.created" || event.type === "attack.started") { active = 1; state = "攻击方正在生成样本"; }
      else if (event.type === "attack.sample.generated") { active = 1; state = "攻击方已提交第 " + event.data.round + " 轮样本"; }
      else if (event.type === "attack.completed") { active = 2; state = "防守方开始逐轮检测"; }
      else if (event.type === "round.started") { active = 2; activeRound = event.data.round; state = "正在检测第 " + event.data.round + " 轮"; }
      else if (event.type === "round.completed") { active = 2; activeRound = null; state = "第 " + event.data.round + " 轮已完成，继续检测"; }
      else if (event.type === "defense.completed") { active = 3; state = "防守分析完成，正在汇总结果"; }
      else if (event.type === "battle.completed") { active = 4; state = "本场对抗已完成"; }
      else if (event.type === "battle.failed") {
        var failedPhase = document.querySelector(".live-phase.active") || document.querySelector('.live-phase[data-phase="attack"]');
        failedPhase.classList.remove("active");
        failedPhase.classList.add("failed");
        failedPhase.querySelector("small").textContent = "本场对抗失败";
        $("event-state").textContent = "本场对抗失败";
        return;
      }
      Array.prototype.forEach.call(document.querySelectorAll(".live-phase"), function (phase, index) {
        phase.classList.remove("active", "done", "failed");
        var hint = phase.querySelector("small");
        if (index < active) { phase.classList.add("done"); hint.textContent = "已完成"; }
        else if (index === active) { phase.classList.add("active"); hint.textContent = state; }
        else { hint.textContent = "等待开始"; }
      });
      $("event-state").textContent = state;
    }
    var dialogTurns = {};
    var replayEvents = [];
    var replayIndex = 0;
    var replayTimer = null;
    var liveEventReader = null;
    function animateExchange(direction, label) {
      var packet = $("exchange-packet");
      packet.className = "exchange-packet";
      packet.textContent = label;
      void packet.offsetWidth;
      packet.classList.add(direction);
    }
    function updateBattleVisual(event) {
      var attacker = $("attacker-card");
      var defender = $("defender-card");
      if (event.data.attackerSource) {
        $("attacker-state").dataset.source = agentSourceLabel(event.data.attackerSource);
      }
      if (event.data.defenderSource) {
        $("defender-state").dataset.source = agentSourceLabel(event.data.defenderSource);
      }
      var attackerLabel = $("attacker-state").dataset.source || "来源未记录";
      var defenderLabel = $("defender-state").dataset.source || "来源未记录";
      $("agent-source-label").textContent = "攻击方：" + attackerLabel + "；防守方：" + defenderLabel;
      attacker.classList.remove("active");
      defender.classList.remove("active");
      if (event.type === "battle.created" || event.type === "attack.started") {
        attacker.classList.add("active");
        $("attacker-state").textContent = attackerLabel + " · 正在生成样本";
        $("defender-state").textContent = "待命";
        $("visual-caption").textContent = "攻击智能体正在构造测试样本";
      } else if (event.type === "attack.sample.generated") {
        var sample = event.data.sample || {};
        var severity = sample.severity === "medium" ? "中" : difficulty(sample.severity);
        attacker.classList.add("active");
        $("attacker-state").textContent = "第 " + event.data.round + " 轮样本已提交";
        $("defender-state").textContent = "等待样本";
        $("visual-caption").textContent = "攻击方发送 " + sampleType(sample.type) + " · " + severity;
        animateExchange("outbound", "第 " + event.data.round + " 轮样本");
      } else if (event.type === "round.started") {
        defender.classList.add("active");
        $("attacker-state").textContent = "样本已提交";
        $("defender-state").textContent = defenderLabel + " · 正在检测第 " + event.data.round + " 轮";
        $("visual-caption").textContent = "防守智能体正在分析攻击样本";
        animateExchange("outbound", "第 " + event.data.round + " 轮送检");
      } else if (event.type === "round.completed") {
        var caught = (event.data.caught || []).length;
        var fixed = (event.data.fixed || []).length;
        $("attacker-state").textContent = "等待下一轮";
        $("defender-state").textContent = "第 " + event.data.round + " 轮已完成";
        $("visual-caption").textContent = "命中 " + caught + " 条样本规则，给出 " + fixed + " 条验证建议";
        animateExchange("returning", "检测回复 · " + caught + " 项");
      } else if (event.type === "defense.completed") {
        $("defender-state").textContent = "检测完成";
        $("visual-caption").textContent = "所有攻击样本均已完成检测";
      } else if (event.type === "battle.completed") {
        $("attacker-state").textContent = "本场完成";
        $("defender-state").textContent = "本场完成";
        $("visual-caption").textContent = "攻防流程结束，结果已汇总";
      } else if (event.type === "battle.failed") {
        $("attacker-state").textContent = "流程中断";
        $("defender-state").textContent = "流程中断";
        $("visual-caption").textContent = "本场攻防失败";
      }
    }
    function ensureRoundDialog(round) {
      if (dialogTurns[round]) return dialogTurns[round];
      var placeholder = $("dialog-log").querySelector(".dialog-empty");
      if (placeholder) placeholder.remove();
      var item = document.createElement("li");
      item.className = "dialog-round event-enter";
      item.dataset.round = round;
      var head = document.createElement("div");
      head.className = "dialog-round-head";
      var title = document.createElement("b");
      title.textContent = "第 " + round + " 轮";
      var state = document.createElement("small");
      state.textContent = "等待样本与检测结果";
      head.appendChild(title);
      head.appendChild(state);
      var pair = document.createElement("div");
      pair.className = "dialog-pair";
      var sides = {};
      ["attacker", "defender"].forEach(function (side) {
        var column = document.createElement("section");
        column.className = "dialog-side " + side;
        var meta = document.createElement("div");
        meta.className = "dialog-side-title";
        var name = document.createElement("b");
        name.textContent = side === "attacker" ? "攻击方 · 测试样本" : "防守方 · 分析结果";
        var status = document.createElement("small");
        status.textContent = side === "attacker" ? "等待提交" : "等待送检";
        meta.appendChild(name);
        meta.appendChild(status);
        var body = document.createElement("div");
        column.appendChild(meta);
        column.appendChild(body);
        pair.appendChild(column);
        sides[side] = {item: column, status: status, body: body};
      });
      item.appendChild(head);
      item.appendChild(pair);
      $("dialog-log").appendChild(item);
      var entry = {item: item, state: state, attacker: sides.attacker, defender: sides.defender};
      dialogTurns[round] = entry;
      return entry;
    }
    function createDialogMessage(side, round, statusText) {
      var group = ensureRoundDialog(round);
      var message = group[side];
      message.status.textContent = statusText;
      if (side === "attacker") group.state.textContent = "样本已提交，等待防守检测";
      return message;
    }
    function appendAttackerMessage(event) {
      var sample = event.data.sample || {};
      var round = event.data.round;
      var message = createDialogMessage("attacker", round, "第 " + round + " 轮 · #" + event.sequence + " · " + formatTime(event.createdAt));
      var tag = document.createElement("div");
      tag.className = "dialog-topic";
      var severity = sample.severity === "medium" ? "中" : difficulty(sample.severity);
      tag.textContent = (sample.simulation ? "本地模拟用例 · " : "") + (sample.testCaseId ? sample.testCaseId + " · " : "") + sampleType(sample.type) + " · " + severity + " · 主题：" + (sample.topic || "未指定");
      var content = document.createElement("p");
      content.className = "dialog-content";
      if (sample.scenario) {
        var scenario = document.createElement("div");
        scenario.className = "dialog-topic";
        scenario.textContent = "场景：" + sample.scenario + (sample.objective ? "；检查目标：" + sample.objective : "");
        message.body.appendChild(scenario);
      }
      content.textContent = sample.content || "（空样本）";
      var raw = document.createElement("details");
      raw.className = "dialog-raw";
      var summary = document.createElement("summary");
      summary.textContent = "查看原始样本 JSON";
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify(sample, null, 2);
      raw.appendChild(summary);
      raw.appendChild(pre);
      message.body.appendChild(tag);
      message.body.appendChild(content);
      message.body.appendChild(raw);
      var group = dialogTurns[round];
      group.state.textContent = "样本已提交，等待防守检测";
    }
    function appendDialogSection(parent, title, items, field, emptyText) {
      var section = document.createElement("div");
      section.className = "dialog-section";
      var heading = document.createElement("b");
      heading.textContent = title;
      var list = document.createElement("ul");
      if (!items || !items.length) {
        var empty = document.createElement("li");
        empty.textContent = emptyText;
        list.appendChild(empty);
      } else {
        items.forEach(function (entry) {
          var row = document.createElement("li");
          var value = entry[field] || entry.reason || entry.action || entry.level || "结果";
          var level = entry.level ? ({low: "低风险", medium: "中风险", high: "高风险"})[entry.level] + " · " : "";
          var status = entry.status ? " · " + statusLabel(entry.status) : "";
          row.textContent = level + (entry.owaspCategory ? entry.owaspCategory + " " + entry.owaspTitle + " · " : "") + (entry.ruleId ? entry.ruleId + " · " : "") + findingText(value) + status;
          if (entry.evidence) {
            var evidence = document.createElement("small");
            evidence.className = "dialog-evidence";
            evidence.textContent = "依据（" + (entry.sourceField || "样本") + "）：" + entry.evidence;
            row.appendChild(document.createElement("br"));
            row.appendChild(evidence);
          }
          if (Array.isArray(entry.matchedText) && entry.matchedText.length) {
            var matched = document.createElement("small");
            matched.className = "dialog-evidence";
            matched.textContent = "命中片段：" + entry.matchedText.join(" / ");
            row.appendChild(document.createElement("br"));
            row.appendChild(matched);
          }
          if (entry.example || entry.verificationSteps || entry.passCriteria || entry.failCriteria) {
            var details = document.createElement("details");
            details.className = "recommendation-details";
            var summary = document.createElement("summary");
            summary.textContent = "查看修复示例与验收标准（建议，未执行）";
            details.appendChild(summary);
            if (entry.example) {
              var exampleTitle = document.createElement("p");
              exampleTitle.textContent = entry.example.title || "修复示例";
              var code = document.createElement("pre");
              code.textContent = entry.example.code || "";
              details.appendChild(exampleTitle);
              details.appendChild(code);
            }
            if (Array.isArray(entry.verificationSteps) && entry.verificationSteps.length) {
              var stepsTitle = document.createElement("p");
              stepsTitle.textContent = "验证步骤";
              var steps = document.createElement("ol");
              entry.verificationSteps.forEach(function (step) {
                var stepItem = document.createElement("li");
                stepItem.textContent = step;
                steps.appendChild(stepItem);
              });
              details.appendChild(stepsTitle);
              details.appendChild(steps);
            }
            if (entry.passCriteria) {
              var pass = document.createElement("p");
              pass.textContent = "通过标准：" + entry.passCriteria;
              details.appendChild(pass);
            }
            if (entry.failCriteria) {
              var fail = document.createElement("p");
              fail.textContent = "失败标准：" + entry.failCriteria;
              details.appendChild(fail);
            }
            row.appendChild(details);
          }
          list.appendChild(row);
        });
      }
      section.appendChild(heading);
      section.appendChild(list);
      parent.appendChild(section);
    }
    function appendDefenderPending(event) {
      var round = event.data.round;
      if (dialogTurns[round] && dialogTurns[round].defender.status.textContent.indexOf("检测中") >= 0) return;
      var message = createDialogMessage("defender", round, "第 " + round + " 轮 · 检测中");
      var pending = document.createElement("p");
      pending.className = "dialog-pending";
      pending.textContent = "正在检查本轮提交的样本文本……";
      message.body.appendChild(pending);
      dialogTurns[round].state.textContent = "防守方正在检测";
    }
    function appendDefenderResponse(event) {
      var round = event.data.round;
      if (!dialogTurns[round]) ensureRoundDialog(round);
      if (!dialogTurns[round].defender.body.childNodes.length) appendDefenderPending({data: {round: round}});
      var message = dialogTurns[round].defender;
      message.status.textContent = "#" + event.sequence + " · " + formatTime(event.createdAt) + " · 检测完成";
      message.body.innerHTML = "";
      if (event.data.verificationStatus) {
        var verification = document.createElement("p");
        verification.className = "dialog-verification";
        verification.textContent = "验证边界：" + event.data.verificationStatus;
        message.body.appendChild(verification);
      }
      appendDialogSection(message.body, "规则命中（样本证据）", event.data.caught, "reason", "未命中当前本地规则");
      appendDialogSection(message.body, "风险评估", event.data.risks, "reason", "无额外风险");
      appendDialogSection(message.body, "修复方向与验收（建议，未执行）", event.data.fixed, "action", "暂无建议");
      if (event.data.scopeNotice || event.data.analysisMode) {
        var mode = document.createElement("p");
        mode.className = "dialog-scope";
        mode.textContent = event.data.scopeNotice || event.data.analysisMode;
        message.body.appendChild(mode);
      }
      var raw = document.createElement("details");
      raw.className = "dialog-raw";
      var summary = document.createElement("summary");
      summary.textContent = "查看原始防守响应 JSON";
      var pre = document.createElement("pre");
      pre.textContent = JSON.stringify({caught: event.data.caught || [], risks: event.data.risks || [], fixed: event.data.fixed || [], verificationStatus: event.data.verificationStatus, scopeNotice: event.data.scopeNotice, analysisMode: event.data.analysisMode}, null, 2);
      raw.appendChild(summary);
      raw.appendChild(pre);
      message.body.appendChild(raw);
      dialogTurns[round].state.textContent = "本轮检测完成 · 结果未验证真实目标";
      $("dialog-log").scrollTop = $("dialog-log").scrollHeight;
    }
    function addEvent(event) {
      var list = $("event-log");
      var placeholder = list.querySelector(".event-placeholder");
      if (placeholder) placeholder.remove();
      var item = document.createElement("li");
      item.className = (event.type === "battle.failed" ? "event-failed " : event.type === "battle.completed" ? "event-done " : "") + "event-enter";
      var time = document.createElement("time");
      time.textContent = formatTime(event.createdAt);
      var text = document.createElement("span");
      var round = event.data && event.data.round ? " · 第 " + event.data.round + " 轮（Round " + event.data.round + "）" : "";
      text.textContent = eventLabel(event.type) + round;
      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
      list.scrollTop = list.scrollHeight;
      updateLiveFlow(event);
      if (event.type === "attack.sample.generated") appendAttackerMessage(event);
      else if (event.type === "round.started") appendDefenderPending(event);
      else if (event.type === "round.completed") appendDefenderResponse(event);
    }
    async function followEvents(battleId) {
      if (liveEventReader) {
        try { await liveEventReader.cancel(); } catch (error) { /* The stream may already be closed. */ }
        liveEventReader = null;
      }
      $("event-log").innerHTML = "";
      $("dialog-log").innerHTML = '<li class="dialog-empty">等待攻击方提交样本（Waiting for attacker samples）</li>';
      dialogTurns = {};
      activeRound = null;
      $("attacker-card").classList.remove("active");
      $("defender-card").classList.remove("active");
      $("attacker-state").dataset.source = "";
      $("defender-state").dataset.source = "";
      $("attacker-state").textContent = "待命（Idle）";
      $("defender-state").textContent = "待命（Idle）";
      $("visual-caption").textContent = "攻防双方准备开始（Agents are ready）";
      $("event-state").textContent = "连接中（Connecting）";
      try {
        var response = await fetch("/battles/" + encodeURIComponent(battleId) + "/events/stream?follow=true");
        if (!response.ok || !response.body) throw new Error("HTTP " + response.status);
        var reader = response.body.getReader();
        liveEventReader = reader;
        var decoder = new TextDecoder();
        var buffer = "";
        var lineBreak = String.fromCharCode(10);
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, {stream: true});
          var blocks = buffer.split(lineBreak + lineBreak);
          buffer = blocks.pop() || "";
          for (var block of blocks) {
            var line = block.split(String.fromCharCode(13)).join("").split(lineBreak).find(function (entry) { return entry.indexOf("data: ") === 0; });
            if (!line) continue;
            var event = JSON.parse(line.slice(6));
            addEvent(event);
            if (["attack.completed", "round.started", "round.completed", "battle.completed"].indexOf(event.type) >= 0) await refreshBattle(battleId);
            if (event.type === "battle.completed" || event.type === "battle.failed") {
              loadDashboardSummary();
              loadHistory();
            }
          }
        }
      } catch (error) {
        $("event-state").textContent = "实时连接中断（Live connection interrupted）";
      } finally {
        if (liveEventReader && liveEventReader === reader) liveEventReader = null;
      }
    }
    function stopReplay() {
      if (replayTimer) window.clearInterval(replayTimer);
      replayTimer = null;
      $("replay-toggle").textContent = "播放";
    }
    function resetReplaySurface() {
      $("event-log").innerHTML = '<li class="event-placeholder">回放从战局创建事件开始</li>';
      $("dialog-log").innerHTML = '<li class="dialog-empty">逐步播放后显示每轮样本与分析结果</li>';
      dialogTurns = {};
      activeRound = null;
      document.querySelectorAll(".live-phase").forEach(function (phase) {
        phase.classList.remove("active", "done", "failed");
        phase.querySelector("small").textContent = "等待回放";
      });
      $("attacker-card").classList.remove("active");
      $("defender-card").classList.remove("active");
      $("attacker-state").textContent = "回放待命";
      $("defender-state").textContent = "回放待命";
      $("visual-caption").textContent = "使用回放控制逐步查看本场记录";
      $("event-state").textContent = "历史战局回放";
    }
    function renderReplayThrough(index) {
      stopReplay();
      replayIndex = Math.max(0, Math.min(index, replayEvents.length));
      resetReplaySurface();
      replayEvents.slice(0, replayIndex).forEach(addEvent);
      $("replay-range").value = replayIndex;
      $("replay-count").textContent = replayIndex + " / " + replayEvents.length + " 个事件";
      $("replay-start").disabled = replayIndex === 0;
      $("replay-prev").disabled = replayIndex === 0;
      $("replay-next").disabled = replayIndex >= replayEvents.length;
      $("replay-range").disabled = replayEvents.length === 0;
      $("result").hidden = replayIndex < replayEvents.length;
      $("event-state").textContent = replayIndex === replayEvents.length && replayIndex > 0 ? "回放结束 · 数据来自已保存事件" : "历史回放 · 已播放 " + replayIndex + " / " + replayEvents.length + " 个事件";
    }
    function openReplay(battleId) {
      stopReplay();
      if (liveEventReader) {
        liveEventReader.cancel().catch(function () {});
        liveEventReader = null;
      }
      Promise.all([
        fetch("/battles/" + encodeURIComponent(battleId)),
        fetch("/battles/" + encodeURIComponent(battleId) + "/replay")
      ]).then(function (responses) {
        if (!responses[0].ok || !responses[1].ok) throw new Error("HTTP " + (!responses[0].ok ? responses[0].status : responses[1].status));
        return Promise.all([responses[0].json(), responses[1].json()]);
      }).then(function (data) {
        var battle = data[0];
        replayEvents = data[1].events || [];
        renderBattle(battle);
        $("battle-id").textContent = battle.id;
        $("replay-controls").hidden = false;
        $("replay-range").max = replayEvents.length;
        document.querySelectorAll(".history-row-active").forEach(function (row) { row.classList.remove("history-row-active"); });
        var button = Array.from(document.querySelectorAll(".history-open")).find(function (item) { return item.dataset.battleId === battleId; });
        if (button) button.closest("tr").classList.add("history-row-active");
        renderReplayThrough(0);
        $("battle-panel").scrollIntoView({behavior: "smooth", block: "start"});
      }).catch(function () {
        $("event-state").textContent = "战局回放加载失败";
      });
    }
    function playReplay() {
      if (replayTimer) { stopReplay(); return; }
      if (!replayEvents.length) return;
      if (replayIndex >= replayEvents.length) renderReplayThrough(0);
      $("replay-toggle").textContent = "暂停";
      replayTimer = window.setInterval(function () {
        if (replayIndex >= replayEvents.length) { stopReplay(); return; }
        replayIndex += 1;
        resetReplaySurface();
        replayEvents.slice(0, replayIndex).forEach(addEvent);
        $("replay-range").value = replayIndex;
        $("replay-count").textContent = replayIndex + " / " + replayEvents.length + " 个事件";
        $("replay-start").disabled = replayIndex === 0;
        $("replay-prev").disabled = replayIndex === 0;
        $("replay-next").disabled = replayIndex >= replayEvents.length;
        $("result").hidden = replayIndex < replayEvents.length;
        if (replayIndex >= replayEvents.length) {
          stopReplay();
          $("event-state").textContent = "回放结束 · 数据来自已保存事件";
        }
      }, Number($("replay-speed").value));
    }
    function loadDashboardSummary() {
      fetch("/dashboard/summary", {cache: "no-store"}).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(renderDashboardSummary).catch(function () {
        $("saved-data-note").textContent = "已保存数据统计暂时无法加载";
      });
    }
    function difficulty(value) { return ({low: "低", mid: "中", high: "高", medium: "中"})[value] || value; }
    function agentSourceLabel(value) {
      var labels = {
        "acp-llm": "独立 ACP Agent · 大模型",
        "acp-rule-fallback": "独立 ACP Agent · 本地规则兜底",
        "acp-pending": "独立 ACP Agent · 来源待确认",
        "local-rule": "主服务 · 本地规则",
      };
      return labels[value] || (typeof value === "string" && value ? "未识别来源 · " + value : "来源未知");
    }
    function sampleType(value) { return ({defect: "缺陷", violation: "违规", vuln: "漏洞"})[value] || value; }
    function statusLabel(value) { return ({pending: "等待中", running: "进行中", completed: "已完成", failed: "失败", recommended: "建议"})[value] || value; }
    function findingText(value) { return ({"missing input validation": "缺少输入校验", "unvalidated input": "未校验输入", "add_input_validation": "增加输入校验", reject_instruction: "拒绝越权指令", use_parameterized_query: "改用参数化查询"})[value] || value; }
    function resultList(items, field, emptyText) {
      if (!items || !items.length) return '<li class="muted">' + escapeHtml(emptyText) + '</li>';
      return items.map(function (item) {
        var value = item[field] || item.reason || item.action || item.level || "结果";
        var taxonomy = item.owaspCategory ? item.owaspCategory + " " + item.owaspTitle + " · " : "";
        var rule = taxonomy + (item.ruleId ? item.ruleId + " · " : "");
        var suffix = item.status ? " · " + statusLabel(item.status) : "";
        var evidence = item.evidence ? " · 依据：" + item.evidence : "";
        var matched = Array.isArray(item.matchedText) && item.matchedText.length ? " · 命中片段：" + item.matchedText.join(" / ") : "";
        var details = "";
        if (item.example || item.verificationSteps || item.passCriteria || item.failCriteria) {
          var parts = [];
          if (item.example) parts.push("<p><b>修复示例：</b>" + escapeHtml(item.example.title || "") + "</p><pre>" + escapeHtml(item.example.code || "") + "</pre>");
          if (Array.isArray(item.verificationSteps) && item.verificationSteps.length) parts.push("<p><b>验证步骤</b></p><ol>" + item.verificationSteps.map(function (step) { return "<li>" + escapeHtml(step) + "</li>"; }).join("") + "</ol>");
          if (item.passCriteria) parts.push("<p><b>通过标准：</b>" + escapeHtml(item.passCriteria) + "</p>");
          if (item.failCriteria) parts.push("<p><b>失败标准：</b>" + escapeHtml(item.failCriteria) + "</p>");
          details = '<details class="recommendation-details"><summary>查看修复示例与验收标准（建议，未执行）</summary>' + parts.join("") + '</details>';
        }
        return '<li>' + escapeHtml(rule + findingText(value) + suffix + evidence + matched) + details + '</li>';
      }).join("");
    }
    function renderHistory(items) {
      $("history").innerHTML = items.length ? items.slice(0, 8).map(function (item) { return `<tr><td>${escapeHtml(item.topic)}</td><td>${difficulty(item.difficulty)}</td><td>${escapeHtml(statusLabel(item.status))}</td><td>${formatTime(item.createdAt)}</td><td><button type="button" class="history-open" data-battle-id="${escapeHtml(item.id)}">查看 / 回放</button></td></tr>`; }).join("") : '<tr><td colspan="5" class="empty">暂无历史战局</td></tr>';
    }
    function renderDashboardSummary(summary) {
      var targets = {totalBattles: "total", completedBattles: "completed-count", failedBattles: "failed-count", sampleCount: "sample-count", ruleHitCount: "rule-hit-count", riskCount: "risk-count", acpRequestCount: "acp-request-count", acpRuleFallbackCount: "acp-fallback-count", reportedLlmResultCount: "llm-result-count", averageAgentCallLatencyMs: "agent-latency"};
      Object.keys(targets).forEach(function (key) { $(targets[key]).textContent = Number(summary[key] || 0).toLocaleString("zh-CN"); });
      $("acp-outcome").textContent = Number(summary.acpSuccessCount || 0).toLocaleString("zh-CN") + " / " + Number(summary.acpFailureCount || 0).toLocaleString("zh-CN");
      $("local-call-count").textContent = Number(summary.localRuleExecutionCount || 0).toLocaleString("zh-CN");
      $("saved-data-note").textContent = "统计来自当前已保存战局 · " + Number(summary.agentExecutionCount || 0).toLocaleString("zh-CN") + " 次 Agent 执行（攻击 " + Number(summary.attackerCallCount || 0).toLocaleString("zh-CN") + " / 防守 " + Number(summary.defenderCallCount || 0).toLocaleString("zh-CN") + "）· 本地模拟样本 " + Number(summary.simulationSampleCount || 0).toLocaleString("zh-CN") + " 条。ACP 只表示协议调用；LLM 次数依据 Partner 返回来源字段，未做独立模型验证。";
    }
    function renderInternalScore(battleId, panel) {
      fetch("/battles/" + encodeURIComponent(battleId) + "/score", {cache: "no-store"}).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(function (result) {
        if (!document.contains(panel)) return;
        panel.replaceChildren();
        var title = document.createElement("h3");
        title.textContent = "内部 Agent 评分 · " + result.version;
        panel.appendChild(title);
        var note = document.createElement("p");
        note.className = "internal-score-note";
        note.textContent = result.message;
        panel.appendChild(note);
        var grid = document.createElement("div");
        grid.className = "internal-score-grid";
        [["攻击 Agent", result.attacker], ["防守 Agent", result.defender]].forEach(function (entry) {
          var card = document.createElement("section");
          card.className = "internal-score-role";
          var heading = document.createElement("strong");
          heading.textContent = entry[0] + "：" + (entry[1].score === null ? "证据不足" : entry[1].score + " / " + entry[1].maxScore);
          card.appendChild(heading);
          var explanation = document.createElement("p");
          explanation.className = "internal-score-note";
          explanation.textContent = entry[1].message;
          card.appendChild(explanation);
          if (entry[1].categories && entry[1].categories.length) {
            var list = document.createElement("ul");
            entry[1].categories.forEach(function (category) {
              var item = document.createElement("li");
              item.textContent = category.label + " " + category.score + "/" + category.maxScore;
              list.appendChild(item);
            });
            card.appendChild(list);
          }
          grid.appendChild(card);
        });
        panel.appendChild(grid);
      }).catch(function () {
        if (document.contains(panel)) panel.textContent = "内部评分暂不可用";
      });
    }
    function renderBattle(battle) {
      var samples = battle.attackerOut.samples || [];
      var defenses = battle.defenderOut || [];
      var caughtCount = defenses.reduce(function (sum, item) { return sum + (item.caught || []).length; }, 0);
      var riskCount = defenses.reduce(function (sum, item) { return sum + (item.risks || []).length; }, 0);
      var fixedCount = defenses.reduce(function (sum, item) { return sum + (item.fixed || []).length; }, 0);
      var attackerSource = agentSourceLabel(battle.attackerOut.agentSource);
      var defenderSources = Array.from(new Set(defenses.map(function (item) { return agentSourceLabel(item.agentSource); })));
      var isSimulation = samples.some(function (sample) { return sample.simulation === true; });
      $("agent-source-label").textContent = "本场来源：攻击 " + attackerSource + " · 防守 " + (defenderSources.join(" / ") || "等待记录");
      $("verification-summary").textContent = isSimulation ? "本地模拟用例 · 真实目标验证：未执行" : "真实目标验证：未执行";
      $("result").hidden = false;
      var rounds = samples.map(function (sample, index) {
        var defense = defenses[index] || {};
        var state = defense.verificationStatus ? "检测完成 · 目标未验证" : battle.status === "failed" ? "战局失败" : "等待检测";
        return `<article class="round"><div class="round-head"><span class="round-number">第 ${index + 1} 轮</span><span class="round-type">${escapeHtml(sampleType(sample.type))} · ${escapeHtml(difficulty(sample.severity))}</span><span class="round-state">${state}</span></div><div class="round-grid"><div class="attack-box"><h3>攻击方 · 样本生成</h3><div><b>场景：</b>${escapeHtml(sample.scenario || "未提供")}</div><div><b>检查目标：</b>${escapeHtml(sample.objective || "未提供")}</div><div><b>主题：</b>${escapeHtml(sample.topic)}</div><div><b>测试输入：</b></div><div class="round-content">${escapeHtml(sample.content)}</div></div><div class="defend-box"><h3>防守方 · 检测与处置</h3><div class="result-label">规则命中（样本证据）</div><ul class="result-list">${resultList(defense.caught, "reason", "未命中当前规则")}</ul><div class="result-label">条件性风险</div><ul class="result-list">${resultList(defense.risks, "reason", "无额外风险记录")}</ul><div class="result-label">修复方向与验收（建议，未执行）</div><ul class="result-list">${resultList(defense.fixed, "action", "暂无建议")}</ul></div></div></article>`;
      }).join("") || '<div class="empty">本轮没有生成样本（No samples generated）</div>';
      var sourceLabel = escapeHtml(isSimulation ? "本地模拟" : attackerSource);
      $("result").innerHTML = `<div class="battle-head"><strong>${escapeHtml(battle.topic)} · ${difficulty(battle.difficulty)}难度</strong><span>${sourceLabel} · ${escapeHtml(statusLabel(battle.status))} · ${formatTime(battle.createdAt)}</span></div><div class="flow"><div class="flow-step"><i>1</i><b>战局创建</b><small>接收主题与难度</small></div><div class="flow-step"><i>2</i><b>攻击生成</b><small>输出 ${samples.length} 个样本</small></div><div class="flow-step"><i>3</i><b>规则分析</b><small>检查提交样本文本</small></div><div class="flow-step"><i>4</i><b>结果汇总</b><small>提出 ${fixedCount} 项验证建议</small></div></div><div class="battle-summary"><div class="summary-item"><b>${samples.length}</b><span>样本数</span></div><div class="summary-item"><b>${caughtCount}</b><span>规则命中</span></div><div class="summary-item"><b>${riskCount}</b><span>条件性风险</span></div><div class="summary-item"><b>${fixedCount}</b><span>验证建议</span></div></div><details class="round-details"><summary>查看逐轮证据详情（${samples.length} 轮）</summary><div class="round-list">${rounds}</div></details>`;
      var scorePanel = document.createElement("section");
      scorePanel.className = "internal-score";
      scorePanel.textContent = "正在计算攻击与防守评分……";
      $("result").appendChild(scorePanel);
      renderInternalScore(battle.id, scorePanel);
      applyEvidenceLabels(battle);
    }
    function applyEvidenceLabels(battle) {
      var flow = $("result").querySelectorAll(".flow-step");
      if (flow[2]) {
        flow[2].querySelector("b").textContent = "规则分析";
        flow[2].querySelector("small").textContent = "只检查提交样本";
      }
      if (flow[3]) flow[3].querySelector("small").textContent = "给出建议，不代表已修复";
      var summary = $("result").querySelectorAll(".summary-item span");
      ["样本数", "规则命中", "条件性风险", "验证建议"].forEach(function (label, index) {
        if (summary[index]) summary[index].textContent = label;
      });
      $("result").querySelectorAll(".round").forEach(function (card, index) {
        var sample = (battle.attackerOut.samples || [])[index] || {};
        var defense = (battle.defenderOut || [])[index] || {};
        var attackBox = card.querySelector(".attack-box");
        var defenseBox = card.querySelector(".defend-box");
        var attackTitle = attackBox && attackBox.querySelector("h3");
        var defenseTitle = defenseBox && defenseBox.querySelector("h3");
        var labels = card.querySelectorAll(".result-label");
        if (attackTitle) attackTitle.textContent = sample.simulation ? "攻击方 · 本地模拟用例" : "攻击方 · 提交样本";
        if (defenseTitle) defenseTitle.textContent = "防守方 · 样本规则分析";
        if (labels[0]) labels[0].textContent = "规则命中（样本证据）";
        if (labels[1]) labels[1].textContent = "条件性风险";
        if (labels[2]) labels[2].textContent = "修复方向与验收（建议，未执行）";
        if (sample.testCaseId && attackBox && attackTitle) {
          var caseId = document.createElement("div");
          caseId.textContent = "用例编号：" + sample.testCaseId;
          attackBox.insertBefore(caseId, attackTitle.nextSibling);
        }
        if (defenseBox && (defense.verificationStatus || defense.scopeNotice)) {
          var scope = document.createElement("p");
          scope.className = "dialog-scope";
          scope.textContent = (defense.verificationStatus || "目标验证状态未知") + (defense.scopeNotice ? "；" + defense.scopeNotice : "");
          defenseBox.appendChild(scope);
        }
      });
    }
    async function refreshBattle(battleId) {
      try {
        var response = await fetch("/battles/" + encodeURIComponent(battleId));
        if (!response.ok) return;
        var battle = await response.json();
        var defenses = battle.defenderOut || [];
        renderBattle(battle);
        document.querySelectorAll(".round-state").forEach(function (state, index) {
          state.textContent = defenses[index] ? "已完成" : activeRound === index + 1 ? "检测中" : "等待检测";
        });
      } catch (error) {
        return;
      }
    }
    function loadHistory() { fetch("/battles?limit=50").then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }).then(renderHistory).catch(function () { $("history").innerHTML = '<tr><td colspan="5" class="error">历史战局暂时无法加载</td></tr>'; }); }
    function checkHealth() {
      var controller = new AbortController();
      var timeout = window.setTimeout(function () { controller.abort(); }, 5000);
      $("status").textContent = "正在检查服务状态……";
      fetch("/health", {cache: "no-store", signal: controller.signal}).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(function (data) {
        $("dot").className = "dot ok";
        $("status").textContent = "服务运行正常";
      }).catch(function (error) {
        $("dot").className = "dot";
        $("status").textContent = error.name === "AbortError" ? "服务检查超时" : "服务检查失败";
      }).finally(function () { window.clearTimeout(timeout); });
    }
    var launchParams = new URLSearchParams(window.location.search);
    var launchTopic = launchParams.get("topic");
    if (launchTopic && launchTopic.trim()) $("topic").value = launchTopic.trim().slice(0, 200);
    var launchDifficulty = launchParams.get("difficulty");
    if (["low", "mid", "high"].indexOf(launchDifficulty) !== -1) {
      var launchRadio = document.querySelector('input[name="difficulty"][value="' + launchDifficulty + '"]');
      if (launchRadio) launchRadio.checked = true;
    }
    checkHealth();
    window.setInterval(checkHealth, 30000);
    $("history").addEventListener("click", function (event) {
      var button = event.target.closest(".history-open");
      if (button) openReplay(button.dataset.battleId);
    });
    $("replay-start").addEventListener("click", function () { renderReplayThrough(0); });
    $("replay-prev").addEventListener("click", function () { renderReplayThrough(replayIndex - 1); });
    $("replay-next").addEventListener("click", function () { renderReplayThrough(replayIndex + 1); });
    $("replay-toggle").addEventListener("click", playReplay);
    $("replay-range").addEventListener("input", function () { renderReplayThrough(Number(this.value)); });
    $("replay-speed").addEventListener("change", function () {
      var wasPlaying = Boolean(replayTimer);
      if (wasPlaying) { stopReplay(); playReplay(); }
    });
    $("battle-form").addEventListener("submit", function (event) { event.preventDefault(); var button = $("start"); var topic = $("topic").value.trim(); var difficultyValue = document.querySelector("input[name=difficulty]:checked").value; if (!topic) return; stopReplay(); $("replay-controls").hidden = true; button.disabled = true; button.textContent = "攻防进行中……"; $("event-log").innerHTML = ""; $("result").hidden = false; $("result").innerHTML = '<div class="empty">正在准备攻防战局</div>'; fetch("/battles?background=true", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({topic: topic, difficulty: difficultyValue})}).then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); }).then(function (battle) { renderBattle(battle); $("battle-id").textContent = battle.id; loadHistory(); loadDashboardSummary(); void followEvents(battle.id); }).catch(function (error) { $("result").innerHTML = '<div class="error">战局创建失败：' + escapeHtml(error.message) + '</div>'; $("event-state").textContent = "创建失败"; }).finally(function () { button.disabled = false; button.textContent = "开始攻防"; }); });
    loadHistory();
    loadDashboardSummary();
  </script>
</body>
</html>""".replace('$("result").innerHTML = "', '$("result").innerHTML = \'')
        .replace('</div>";\n', "</div>';\n")
        .replace('class="battle-head"', 'class=\\"battle-head\\"')
        .replace('class="flow"', 'class=\\"flow\\"')
        .replace('class="flow-step"', 'class=\\"flow-step\\"')
        .replace('class="battle-summary"', 'class=\\"battle-summary\\"')
        .replace('class="summary-item"', 'class=\\"summary-item\\"')
        .replace('class="round-list"', 'class=\\"round-list\\"')
        .replace(',""":"&quot;",', ',\\"":"&quot;",')
        .replace("__INITIAL_TOPIC__", topic_value)
        .replace("__LOW_CHECKED__", "checked" if selected_difficulty == "low" else "")
        .replace("__MID_CHECKED__", "checked" if selected_difficulty == "mid" else "")
        .replace("__HIGH_CHECKED__", "checked" if selected_difficulty == "high" else "")
    )
