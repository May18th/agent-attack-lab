"""对 leader-mtls 入口做「服务端身份 + 双向认证」实测，四态一次打完。

为什么不用 curl：Windows 的 curl 走 schannel，对 Agent CA 签发的私有链握手失败
（attack / defense 也是返回 000），因此这里用 Python 的 ssl 模块直接建链。

验证四件事（判定口径与 nginx 配置一一对应）：

1. 读服务端证书 —— subject / SAN 必须绑定到主调度自己的 AIC，
   即 ``URI:acps://<AIC>`` + ``DNS:<endpoint 主机名>``。这是「服务端身份可校验」
   的实证，不是口头声明。
2. 无客户端证书 ``GET /health`` —— 期望 200（探活不要求证书）。
3. 无客户端证书 ``POST /rpc``   —— 期望 403（nginx 拦在 TLS 层）。
4. 带主调度 clientAuth 证书 ``POST /rpc`` —— 期望 200。
   返回 JSON-RPC 的 ``-32601 Method not found`` 是**正常**的：说明请求已经穿过
   nginx 的 mTLS 校验、穿过内部鉴权、抵达 FastAPI 并进入了方法分发。
   若这里出现 401，说明后端 API key 没被注入；出现 403 说明客户端证书没被接受。

用法（在 backend 目录）：

    .venv\\Scripts\\python.exe scripts\\probe_leader_mtls.py
    .venv\\Scripts\\python.exe scripts\\probe_leader_mtls.py --host leader-mtls.example.cn
"""

from __future__ import annotations

import argparse
import json
import socket
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_HOST = "leader-mtls.yuanyiagentzhandui.cn"
DEFAULT_ACPS = (
    Path(__file__).resolve().parents[1]
    / ".data"
    / "acps-registration-v4-leader-mtls"
    / "leader"
    / "acps"
)

AIP_BODY = json.dumps(
    {"jsonrpc": "2.0", "id": "probe-1", "method": "aip.discover", "params": {"query": "ping"}}
).encode()


def base_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    # 服务端证书由私有 Agent CA 签发，公共信任库验不过；链的严格校验由 nginx -t
    # 与部署时的指纹比对负责，这里只验证「出示了哪张证书」与「是否接受客户端证书」。
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def probe_peer_cert(host: str) -> dict:
    ctx = base_context()
    with socket.create_connection((host, 443), timeout=15) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as tls:
            der = tls.getpeercert(binary_form=True)
            info: dict = {"version": tls.version(), "der_len": len(der) if der else 0}
    if not der:
        return info

    with tempfile.NamedTemporaryFile("wb", suffix=".der", delete=False) as fh:
        fh.write(der)
        path = fh.name
    try:
        out = subprocess.run(
            [
                "openssl",
                "x509",
                "-inform",
                "DER",
                "-in",
                path,
                "-noout",
                "-subject",
                "-ext",
                "subjectAltName",
            ],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("subject=") or "DNS:" in line or "URI:" in line:
                info.setdefault("fields", []).append(line)
    finally:
        Path(path).unlink(missing_ok=True)
    return info


def request(
    host: str,
    path: str,
    *,
    method: str,
    cert_dir: Path | None,
    body: bytes | None = None,
) -> dict:
    import http.client

    ctx = base_context()
    if cert_dir is not None:
        ctx.load_cert_chain(
            certfile=str(cert_dir / "certificate.pem"),
            keyfile=str(cert_dir / "private-key.pem"),
        )
    conn = http.client.HTTPSConnection(host, 443, context=ctx, timeout=20)
    headers = {"Content-Type": "application/json"} if body else {}
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        payload = resp.read(300)
        return {"status": resp.status, "head": payload[:160]}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--acps-dir", type=Path, default=DEFAULT_ACPS)
    args = parser.parse_args()

    client_dir = args.acps_dir / "client"
    if not (client_dir / "certificate.pem").is_file():
        print(f"找不到客户端证书：{client_dir}/certificate.pem", file=sys.stderr)
        return 2

    print(f"目标：https://{args.host}")
    print("服务端证书：")
    print("  ", json.dumps(probe_peer_cert(args.host), ensure_ascii=False))

    cases = [
        ("无证书 GET /health", dict(path="/health", method="GET", cert_dir=None), 200),
        ("无证书 POST /rpc", dict(path="/rpc", method="POST", cert_dir=None, body=AIP_BODY), 403),
        (
            "带证书 POST /rpc",
            dict(path="/rpc", method="POST", cert_dir=client_dir, body=AIP_BODY),
            200,
        ),
        ("带证书 GET /health", dict(path="/health", method="GET", cert_dir=client_dir), 200),
    ]

    ok = True
    for label, kwargs, expect in cases:
        res = request(args.host, **kwargs)
        status = res.get("status", res.get("error", "?"))
        passed = status == expect
        ok = ok and passed
        print(f"{'PASS' if passed else 'FAIL'}  {label:<20} 期望 {expect}  实际 {status}")
        if isinstance(res.get("head"), bytes):
            print(f"        响应前 160 字节：{res['head']!r}")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
