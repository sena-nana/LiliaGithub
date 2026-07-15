# GitHub 个人账号与组织仓库

LiliaGithub 将个人账号和 GitHub Organization 视为独立的仓库来源。仓库始终使用 GitHub repository ID 或 `owner/repo` 识别，因此不同 owner 下的同名仓库不会互相覆盖。

## 仓库范围

远程仓库列表、克隆选择器和侧边栏支持三种范围：

- 全部：当前 GitHub 授权可访问的个人、组织成员和 collaborator 仓库。
- 个人：由当前认证账号拥有的仓库。
- 组织：由指定 Organization 拥有、且当前授权可访问的仓库。

组织成员身份与单个仓库权限是两件事。LiliaGithub 始终保留 GitHub 返回的仓库权限，不会因为用户属于某个组织就假定其可以推送或管理该组织的仓库。仅通过仓库协作权限访问的组织也不会被标记为“已加入的组织”。

## 组织授权

完整读取私有组织成员关系需要 GitHub OAuth 的 `read:org` scope。设置页会显示 GitHub 实际授予的 scope：

- 已授予 `read:org` 时，组织成员关系与可访问仓库 owner 会合并展示。
- 未授予或用户拒绝增权时，仓库功能仍然可用，但界面会明确提示组织信息可能不完整。
- 重新授权后会废止旧的 owner、仓库分页和权限缓存，避免账号或授权范围之间串用数据。

若组织启用了 SAML SSO 或限制 OAuth App，GitHub 可能只返回部分仓库。LiliaGithub 会保留当前可用结果，并显示相应的授权恢复提示。

## 默认克隆目录

从 GitHub 仓库列表发起的新 clone 默认写入：

```text
<workspaceRoot>/<owner>/<repo>
```

个人仓库和组织仓库遵循同一规则。owner 与 repo 目录段会转换为 Windows、macOS 和 Linux 都可安全使用的名称，并检测大小写冲突、保留名和已有目标。

用户显式选择自定义目标时不会再自动嵌套 owner。若目标已经存在：

- Git remote 指向同一 `owner/repo` 时，LiliaGithub 会关联并打开现有仓库。
- Git remote 指向其他仓库时会报告冲突，不会覆盖目录。
- 非 Git 且非空的目录会被拒绝。

clone 失败时只会清理由本次操作新建且仍为空的 owner 目录。

## 旧工作区兼容

已有的 `<workspaceRoot>/<repo>` 仓库会继续按原路径打开、刷新、提交和同步。升级、启动或刷新不会静默移动、重命名或删除旧目录；LiliaGithub 只会在能够从 Git remote 确认身份时补全 `owner/repo` 绑定。

