# 发布到插件市场

DSH 的市场（`dshmarket`）本身没有上传入口，它是一个 **npm 目录的消费端**：市场列表来自别人发布在 npm 上的、带 `dsh` 关键字的包；用户点「安装」时，市场执行的是 `<包名>` 或 `github:owner/repo` 的安装。

所以「发布到市场」= **把这个包发上 npm**，并且让包名、`package.json` 的 `dsh` 字段与 `keywords` 可被发现。

## 0. 发布前检查

```bash
node test/smoke.mjs          # 必须 SMOKE OK
node test/client-smoke.cjs   # 必须 CLIENT SMOKE OK
pnpm pack --dry-run          # 看打进 tarball 的文件清单
```

清单应当只有：`package.json`、`README.md`、`LICENSE`、`CHANGELOG.md`、`lib/index.js`、`lib/client.js`、`cordis.patch.yml`。
（`files` 字段已限定了前四项之外的白名单，`test/` 不会进包。）

确认这几项：

- `name` 不与 npm 上已有包冲突：`npm view dsh-thinking-review version`
- `version` 是新的：改版本号的同时更新 `CHANGELOG.md`
- `dsh.bundle.patch` 指向 `./cordis.patch.yml`，且该文件在包内
- `dsh.client.platform = "web"` 且 `main`/`exports` 都指向包内真实文件

## 1. 登录 npm

需要一个 npm 账号，并且该账号有权限发布这个包名（未占用就直接发；已占用见第 4 节改 scope）。

```bash
npm login          # 浏览器 / OTP
npm whoami         # 确认登录身份
```

本机如果没有全局 npm，用 DSH 自带的那份：

```bash
NODE="C:/Users/HoaXQ/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
NPM_CLI="C:/Users/HoaXQ/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/node_modules/npm/bin/npm-cli.js"
"$NODE" "$NPM_CLI" login
"$NODE" "$NPM_CLI" whoami
```

凭据会写进 `~/.npmrc`；**不要**把 token 写进这个仓库的任何文件。

## 2. 打包与本地验包

```bash
"$NODE" "C:/Users/HoaXQ/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs" pack
tar -tzf dsh-thinking-review-1.0.0.tgz      # Windows 可用 7z l
```

验包（关键一步：模拟市场装包）：

```bash
mkdir -p /tmp/verify && cd /tmp/verify
"$NODE" "$NPM_CLI" init -y
"$NODE" "$NPM_CLI" i "C:/Users/HoaXQ/Desktop/插件/dsh-thinking-review/dsh-thinking-review-1.0.0.tgz"
node -e "import('dsh-thinking-review').then(m=>console.log(m.name, m.inject))"
```

期望输出：`dsh-thinking-review [ 'webServer', 'agents' ]`。

## 3. 发布

```bash
"$NODE" "$NPM_CLI" publish --access public
```

发布后确认：

```bash
"$NODE" "$NPM_CLI" view dsh-thinking-review version dist.tarball
```

## 4. 让市场能搜到

市场按关键字抓目录，确认 `package.json` 里有：

```json
"keywords": ["dsh", "dsh-plugin", "clarify", "thinking", "review", "memory"]
```

装的时候写 `dsh-thinking-review`（npm 名）或 `github:HoaXQ/dsh-thinking-review`（仓库方式）。

若包名已被占用，改成带 scope 的名字再发：

```bash
# package.json: "name": "@hoaxq/dsh-thinking-review"
"$NODE" "$NPM_CLI" publish --access public
```

市场里就按 `@hoaxq/dsh-thinking-review` 安装（scope 包要 `--access public` 才公开可见）。

## 5. 后续版本

1. 改 `version`（语义化：修 bug 用 patch，加功能用 minor）
2. 更新 `CHANGELOG.md`
3. 跑两个测试
4. `npm publish`
5. 用户侧：市场里点更新，或 `dsh plugin add dsh-thinking-review@latest`，再重启

预发布用 `npm publish --tag next`，默认 `latest` 不受影响。

## 6. GitHub 同步（可选，便于 `github:` 安装）

本机 git 在 `D:\Git\cmd\git.exe`（不在 PATH 里，要写全路径或用 `D:\Git\cmd`）。
SSH 已配好：`~/.ssh\config` 把 github.com 指向 `ssh.github.com:443`，密钥 `~/.ssh/id_ed25519`，账号 **HoaXQuill**（`ssh -T git@github.com` 已验证通过）。

```powershell
$git = "D:\Git\cmd\git.exe"
& $git init
& $git add -A
& $git -c user.name="HoaXQuill" -c user.email="316784193+HoaXQuill@users.noreply.github.com" commit -m "feat: dsh-thinking-review 1.0.0"
& $git branch -M main
& $git remote add origin git@github.com:HoaXQuill/dsh-thinking-review.git
& $git push -u origin main
```

推送前仓库必须先在 GitHub 上建好（空仓库，**不要**勾 README / .gitignore，否则首推会被拒）。
建成后市场里按 `github:HoaXQuill/dsh-thinking-review` 安装。

沙箱内推送的坑与解法（实测）：

- TLS 报 `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` 时，说明走了 Schannel 后端，换 `-c http.sslBackend=openssl`。
- 更常见的是 Git for Windows 自带的 cygwin `ssh.exe` / `sh.exe` 无法创建命名管道，报 `fatal error - couldn't create signal pipe, Win32 error 5`，随后是 "Please make sure you have the correct access rights"。**解法：改用 Windows 原生 OpenSSH，并绕过 git 的 shell 包装**：

```powershell
$env:GIT_SSH = "C:/Windows/System32/OpenSSH/ssh.exe"
$env:GIT_SSH_VARIANT = "ssh"
& "D:\Git\cmd\git.exe" push origin main
```

注意用 `GIT_SSH`（直接 exec 程序）而不是 `GIT_SSH_COMMAND`/`core.sshCommand`（要经过 sh，仍会失败）。
主机别名与端口已在 `~/.ssh/config` 里写好，可直接吃默认配置。

`node_modules/`、`*.tgz`、`_recon/` 已在 `.gitignore` 里，不会误提交。
