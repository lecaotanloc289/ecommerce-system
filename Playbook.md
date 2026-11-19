# PLAYBOOK: Vibe Code End-to-End với Claude Code (Dự án mới)

> Mục tiêu: setup 1 lần, code nhanh tối đa, an toàn tối đa. Đã đối chiếu docs chính thức tháng 6/2026.

---

## 0. Ba nguyên tắc cốt lõi

1. **Context là tài nguyên quý nhất** — context đầy thì chất lượng giảm. Mọi practice xoay quanh việc giữ context sạch.
2. **Closed-loop verification** — Claude phải tự kiểm chứng được kết quả (test, lint, build exit code). Không có vòng kiểm chứng = không vibe code.
3. **An toàn theo lớp** — permissions → hooks → sandbox/container → git. Không phụ thuộc 1 lớp duy nhất.

---

## 1. Checklist chuẩn bị (làm 1 lần, ~30 phút)

### A. Môi trường

- [ ] Cài Claude Code + đăng nhập
- [ ] `git init` + `.gitignore` ngay từ commit đầu tiên
- [ ] Scaffold project: script `dev`, `test`, `lint`, `typecheck` **chạy được** trước khi vibe code
- [ ] (Khuyến nghị) Devcontainer/Docker nếu muốn dùng auto-accept mạnh tay

### B. Cấu hình Claude (chi tiết ở mục 2–5)

- [ ] Chạy `/init` tạo CLAUDE.md → tinh gọn lại, giữ **dưới 200 dòng**
- [ ] `.claude/settings.json`: khai báo permissions allow/ask/deny
- [ ] Hooks: auto-format + typecheck sau mỗi Edit
- [ ] `.claude/rules/`: tách rule theo path (frontend/backend)
- [ ] Subagent `code-reviewer` trong `.claude/agents/`
- [ ] `.mcp.json` nếu cần (GitHub, DB...) — chỉ server tin cậy

### C. Quy trình

- [ ] Quy ước: 1 feature = 1 branch, commit nhỏ và thường xuyên
- [ ] Definition of Done: lint + typecheck + test pass + `/security-review` sạch

---

## 2. Cấu trúc thư mục chuẩn

```
project-root/
├── CLAUDE.md                    # Bộ nhớ dự án (<200 dòng) — commit
├── .claude/
│   ├── settings.json            # Settings team — commit
│   ├── settings.local.json      # Cá nhân — tự động gitignore
│   ├── rules/                   # Rule theo path — commit
│   │   ├── frontend.md
│   │   └── backend.md
│   ├── skills/                  # Skill tự kích hoạt — commit
│   ├── agents/
│   │   └── code-reviewer/AGENT.md
│   └── commands/                # Slash command thủ công
├── .mcp.json                    # MCP servers — commit
└── .gitignore
```

`.gitignore` tối thiểu:

```gitignore
.claude/settings.local.json
CLAUDE.local.md
.env
.env.local
node_modules/
```

---

## 3. CLAUDE.md mẫu (greenfield)

```markdown
# <Tên dự án>

## Stack

- Backend: NestJS + BullMQ + PostgreSQL
- Frontend: Next.js (App Router) + TanStack Query
- Package manager: pnpm

## Lệnh quan trọng

- `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- Chạy 1 test: `pnpm test -- <path>`

## Quy ước

- TypeScript strict, không dùng `any`
- Service theo SOLID, function < 40 dòng
- Commit message: conventional commits (feat/fix/chore)
- KHÔNG tự ý cài thư viện mới — hỏi trước

## Definition of Done

- lint + typecheck + test đều pass trước khi báo hoàn thành

## Tham chiếu

- Workflow git: @docs/git-instructions.md
```

Lưu ý: dùng `@file` để import file khác (tối đa 4 cấp). File càng ngắn Claude tuân thủ càng tốt — review CLAUDE.md như review code.

---

## 4. settings.json — An toàn bằng permissions

`.claude/settings.json` (commit, dùng chung team):

```json
{
  "$schema": "https://code.claude.com/schemas/settings-schema.json",
  "model": "sonnet",
  "permissions": {
    "allow": [
      "Read(**)",
      "Edit(src/**)",
      "Bash(pnpm test)",
      "Bash(pnpm lint)",
      "Bash(pnpm typecheck)",
      "Bash(git status)",
      "Bash(git diff)",
      "Bash(git log)"
    ],
    "ask": ["Bash(git push)", "Bash(pnpm add)", "Edit(.env*)", "Edit(package.json)"],
    "deny": ["Read(.env*)", "Read(**/secrets/**)", "Bash(sudo)", "Bash(rm -rf)", "Bash(curl)"]
  }
}
```

Quy tắc đánh giá: **deny > ask > allow** — match deny ở bất kỳ cấp nào là chặn hẳn.

### Permission modes (Shift+Tab để chuyển)

| Mode                        | Khi nào dùng                                                 |
| --------------------------- | ------------------------------------------------------------ |
| Default                     | Mặc định, hỏi trước khi edit/chạy lệnh                       |
| Auto-accept (`acceptEdits`) | Khi đã duyệt plan, để Claude code liền mạch                  |
| Plan mode                   | Trước mọi feature/refactor lớn — chỉ đọc, đề xuất, không sửa |
| Auto mode                   | Classifier nền tự chặn hành vi vượt scope, prompt injection  |

**`--dangerously-skip-permissions`**: chỉ dùng trong container/VM cách ly không internet. Không bao giờ dùng trên máy thật có credentials.

---

## 5. Hooks — chất lượng tự động

Thêm vào `.claude/settings.json`:

```json
{
  "hooks": [
    {
      "event": "PostToolUse",
      "matcher": "Write|Edit",
      "action": {
        "type": "command",
        "command": "npx prettier --write {toolArgs.path} && pnpm typecheck"
      }
    },
    {
      "event": "PreToolUse",
      "matcher": "Bash",
      "action": {
        "type": "command",
        "command": "echo \"$TOOL_INPUT\" | grep -qE 'rm -rf|--force|sudo' && exit 2 || exit 0"
      }
    }
  ]
}
```

- `PostToolUse` + format/typecheck = lỗi bị bắt **ngay khi vừa sửa file**, không tích lũy.
- `PreToolUse` exit code 2 = chặn lệnh trước khi chạy.
- Event hữu ích khác: `SessionStart` (load context), `Stop` (chạy test cuối turn), `PreCompact`.

---

## 6. Workflow end-to-end cho mỗi feature

```
/clear → Plan mode → duyệt plan → Auto-accept code → closed-loop test → review → commit
```

1. **`/clear`** — bắt đầu feature mới với context sạch. Không trộn nhiều task vào 1 session.
2. **Plan mode** (Shift+Tab): mô tả feature, yêu cầu plan. Việc khó thêm từ khóa **`ultrathink`** để suy luận sâu (chỉ `ultrathink` có tác dụng, "think hard" không).
3. **Duyệt plan** — đây là điểm kiểm soát quan trọng nhất. Plan sai thì code chắc chắn sai.
4. **Chuyển auto-accept**, để Claude implement. Hooks tự format + typecheck sau mỗi edit.
5. **Closed-loop**: yêu cầu Claude chạy test và tự sửa đến khi pass. Đây là lúc vibe code thật sự — bạn không cần can thiệp.
6. **Lệch hướng?** `Esc` ngắt ngay, hoặc `Esc Esc` / `/rewind` quay về checkpoint (khôi phục code, hội thoại, hoặc cả hai). Checkpoint không thay thế git.
7. **`/security-review`** trước khi commit.
8. **Subagent review**: cho 1 Claude khác review code Claude đầu viết (mục 7).
9. **Commit nhỏ** — mỗi bước hoàn chỉnh 1 commit, dễ rollback.

---

## 7. Hiệu suất và chi phí

### Quản lý context

- `/context` — xem context đang tốn vào đâu
- `/compact focus on <chủ đề>` — nén có định hướng khi session dài
- `/clear` — luôn rẻ hơn `/compact` nếu task không liên quan

### Chọn model (`/model`)

| Model              | Dùng cho                                                  |
| ------------------ | --------------------------------------------------------- |
| `haiku`            | Việc vặt: rename, sửa typo, viết test đơn giản            |
| `sonnet`           | Coding hằng ngày (mặc định, tỉ lệ giá/hiệu năng tốt nhất) |
| `opus` / `fable-5` | Kiến trúc, debug khó, refactor lớn                        |
| `opusplan`         | Hybrid: plan bằng Opus, code bằng Sonnet — tối ưu chi phí |

### Subagents song song

`.claude/agents/code-reviewer/AGENT.md`:

```yaml
---
name: Code Reviewer
description: Review code về bug, bảo mật, hiệu năng
model: sonnet
---

Bạn là reviewer khó tính. Kiểm tra: logic bug, lỗ hổng bảo mật,
N+1 query, race condition trong BullMQ worker. Trả về danh sách
issue kèm file:line và đề xuất fix.
```

Mỗi subagent có context window riêng → dùng cho research/review/test song song. Không dùng cho việc vặt (tốn token theo số agent).

---

## 8. An toàn dữ liệu và secrets

- **Secrets không bao giờ vào context**: `Read(.env*)` trong `deny`. Nếu lệnh in ra credential, nó nằm trong transcript — đặt `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` hoặc giảm `cleanupPeriodDays` nếu nhạy cảm.
- **MCP**: chỉ thêm server tin cậy. MCP server lạ = nguy cơ leo thang quyền + prompt injection. Commit `.mcp.json` để team thấy prompt phê duyệt khi clone.
- **Commit**: `settings.json`, `CLAUDE.md`, `rules/`, `skills/`, `agents/`, `.mcp.json`. **Ignore**: `settings.local.json`, `CLAUDE.local.md`, `.env*`.
- **CI/headless**: `claude -p "<prompt>" --allowedTools "Read,Edit" --permission-mode plan` — giới hạn tool tối thiểu, chạy trong container cách ly.

---

## 9. Checklist nhanh mỗi session (dán cạnh màn hình)

```
TRƯỚC:  /clear → đúng branch? → task đủ nhỏ?
PLAN:   Shift+Tab → plan mode → ultrathink nếu khó → duyệt kỹ plan
CODE:   auto-accept → hooks tự check → Esc nếu lệch → Esc Esc rewind
SAU:    test pass? → /security-review → subagent review → commit nhỏ
```

---

## Nguồn

- [Best practices — Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Permissions](https://code.claude.com/docs/en/permissions) · [Hooks](https://code.claude.com/docs/en/hooks) · [Memory](https://code.claude.com/docs/en/memory) · [Subagents](https://code.claude.com/docs/en/sub-agents) · [MCP](https://code.claude.com/docs/en/mcp) · [Checkpointing](https://code.claude.com/docs/en/checkpointing) · [Model config](https://code.claude.com/docs/en/model-config) · [Sandboxing](https://code.claude.com/docs/en/sandboxing)
