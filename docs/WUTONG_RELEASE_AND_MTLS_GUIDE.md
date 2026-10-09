# 梧桐 ACPs 发行文件与生产证书获取指南

本文根据梧桐官方使用指南、WIT 手册以及 ACPs v2.2.0 的 `acps-cli` 文档整理，覆盖发行文件获取、网络前置条件、生产地址，以及审核通过后获取 EAB 和 Ed25519 mTLS 证书的流程。

## 官方文档

- [梧桐智能体互联平台使用指南](https://wt.ioa.pub/docs.html)
- [WIT 手册](https://wt.ioa.pub/flux/docs/)
- [ACPs SDK v2.2.0 README](https://github.com/AIP-PUB/ACPs-community/blob/v2.2.0/acps-sdk/README.md)
- [acps-cli v2.2.0 README](https://github.com/AIP-PUB/ACPs-community/blob/v2.2.0/acps-cli/README.md)
- [ACPs 注册平台](https://wt.ioa.pub/registry/)

## 1. 官方发行文件

WIT v2.1.0 要求使用与 ACPs SDK v2.2.0 配套的官方发行目录。目录中应同时存在以下三个文件：

```text
<release_dir>/
├── acps_sdk-2.2.0-py3-none-any.whl
├── wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl
└── release-manifest.json
```

版本必须严格匹配：先安装 `acps-sdk 2.2.0`，再安装 `wit-framework 2.1.0`。公开页面说明了文件名和校验方式，但没有提供公开下载 URL；应从梧桐项目维护方或平台运营方获取正式发行目录。不要混用第三方 wheel、源码构建产物或其他版本的 SDK。

Python 要求：CPython 3.12、3.13 或 3.14（`>=3.12,<3.15`）。

安装并执行发行预检：

```bash
cd <release_dir>
python -m pip install ./acps_sdk-2.2.0-py3-none-any.whl
python -m pip install ./wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl

wit-release-preflight --manifest release-manifest.json
```

可额外核对导入来源和版本：

```bash
python -c "from importlib.metadata import version; import acps_sdk, wit; print(version('acps-sdk'), acps_sdk.__file__); print(version('wit-framework'), wit.__file__)"
```

预期版本分别为 `2.2.0` 和 `2.1.0`，并且两个包都应从当前 Python 环境的 `site-packages` 导入。

如果使用基于 RabbitMQ 的 AIP Group，需要安装可选依赖：

```bash
python -m pip install './wit_framework-2.1.0-cp312.cp313.cp314-none-any.whl[acps-group]'
```

## 2. 网络与零信任权限

官方文档没有要求额外开通某个特定的“梧桐网络”或零信任角色。实际前置条件是：

1. 开发机或部署机可以通过 HTTPS/443 访问梧桐生产服务。
2. 开发者拥有梧桐账号，并能登录注册平台。
3. 每个 Agent 的 ACS 审核通过并取得各自的 AIC。
4. 企业出口若有限制，需要网络管理员对白名单、代理或 TLS 检查策略放行相关域名。

证书和 EAB 的权限由 Registry 的登录身份、审核状态和 AIC 控制，不是普通的网络连通权限。两个 Agent 必须分别取得 AIC，并分别获取 EAB、私钥和证书。

## 3. 生产地址

### 注册平台

```text
https://wt.ioa.pub/registry/
```

### `acps-cli.toml`

```toml
[registry]
base_url = "https://wt.ioa.pub/registry-server"

[auth]
user_token_file = "./.acps-cli/tokens/registry-user.json"
admin_token_file = "./.acps-cli/tokens/registry-admin.json"

[ca]
base_url = "https://wt.ioa.pub/ca-server"

[discovery]
base_url = "https://wt.ioa.pub/discovery"
```

Registry 用于登录、注册状态和 EAB；CA 用于证书申请与状态管理；Discovery 用于后续发现和可见性验证。

## 4. 审核通过后获取 EAB

先使用开发者账号登录 Registry：

```bash
acps-cli --config acps-cli.toml auth login
```

登录成功后，使用该 Agent 审核通过后的 AIC 获取 EAB：

```bash
acps-cli --config acps-cli.toml cert eab fetch \
  --aic <AIC> \
  --output eab.json \
  --json
```

`eab.json` 是后续 CA 签发证书的输入文件，应限制文件权限并避免提交到公开仓库。

## 5. 获取 Ed25519 mTLS 证书

`acps-cli` v2.2.0 的 `cert issue` 默认密钥类型为 Ed25519，也可以显式指定 `--key-type ed25519`。

### clientAuth 证书

用于 Agent 作为客户端访问 Registry、CA、MQ 或其他 mTLS 服务：

```bash
acps-cli --config acps-cli.toml cert issue \
  --aic <AIC> \
  --eab-file eab.json \
  --usage clientAuth \
  --key-type ed25519 \
  --key-path agent-key.pem \
  --cert-path agent-cert.pem \
  --trust-bundle-path trust-bundle.pem
```

短参数等价写法：

```bash
acps-cli --config acps-cli.toml cert issue \
  -a <AIC> \
  --eab-file eab.json \
  -u clientAuth \
  --key-type ed25519 \
  --key-path agent-key.pem \
  --cert-path agent-cert.pem \
  --trust-bundle-path trust-bundle.pem
```

### serverAuth 证书

如果 Agent 需要监听 HTTPS 并接受其他 Agent 的 mTLS 调用，再申请一套独立的 serverAuth 证书：

```bash
acps-cli --config acps-cli.toml cert issue \
  --aic <AIC> \
  --eab-file eab.json \
  --usage serverAuth \
  --key-type ed25519 \
  --key-path agent-server-key.pem \
  --cert-path agent-server-cert.pem \
  --trust-bundle-path trust-bundle.pem
```

不要复用 clientAuth 和 serverAuth 的私钥文件，除非部署规范明确允许。

## 6. 证书检查与部署

查询证书状态：

```bash
acps-cli --config acps-cli.toml cert status --aic <AIC>
```

部署前应确认：

- 证书 CN 与 AIC 一致；
- 存在唯一的 `acps://<AIC>` URI SAN；
- clientAuth/serverAuth EKU 与申请用途一致；
- 私钥与 leaf certificate 公钥匹配；
- 证书链可以验证到 `trust-bundle.pem`；
- serverAuth 证书的 DNS/IP SAN 覆盖 Agent 的公开 endpoint。

私钥、EAB、访问令牌和证书材料都不应提交到公开 Git 仓库。后续修改 Agent 能力、服务地址或输入输出格式时，应在注册平台同步更新 ACS。

## 7. 推荐执行顺序

```text
获取官方发行目录
  -> 安装 acps-sdk 2.2.0
  -> 安装 wit-framework 2.1.0
  -> 运行 wit-release-preflight
  -> 在注册平台提交 ACS
  -> 审核通过并取得 AIC
  -> acps-cli auth login
  -> cert eab fetch
  -> cert issue --usage clientAuth --key-type ed25519
  -> （需要监听时）cert issue --usage serverAuth --key-type ed25519
  -> 部署证书并验证 Discovery/调用链路
```
