"""Generate core-function SVG diagrams with no external dependencies."""
from pathlib import Path
from html import escape

OUT = Path(__file__).resolve().parents[1] / 'diagrams'

class Diagram:
    def __init__(self, name, title, subtitle, height=740):
        self.name = name
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="{height}" viewBox="0 0 1280 {height}" role="img" aria-labelledby="title desc">',
            f'<title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle)}</desc>',
            '<style>text{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>',
            f'<rect width="1280" height="{height}" fill="#f3f3f1"/>',
            '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M1 1L8 4.5L1 8" fill="none" stroke="#62645c" stroke-width="1.5"/></marker></defs>']
        self.text(40, 60, title, 28, '#252622', 650)
        self.text(40, 94, subtitle, 15)

    def text(self, x, y, text, size=15, color='#62645c', weight=400):
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}">{escape(text)}</text>')

    def box(self, x, y, title, lines, width=360, height=132, fill='#ffffff', stroke='#d3d5cd'):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="6" fill="{fill}" stroke="{stroke}"/>')
        self.text(x+18, y+32, title, 18, '#252622', 600)
        for i, line in enumerate(lines):
            self.text(x+18, y+61+i*23, line, 14)

    def arrow(self, points, dashed=False, color='#62645c'):
        d = 'M' + ' L'.join(f'{x},{y}' for x, y in points)
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.5" marker-end="url(#arrow)"'+(' stroke-dasharray="6 5"' if dashed else '')+'/>')

    def save(self):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / self.name).write_text('\n'.join(self.parts)+ '\n</svg>\n')


def workflow():
    d = Diagram('core-workflow.svg', '核心工作闭环', '会话由主机统一执行，桌面与手机共享查看和控制能力')
    d.box(40, 145, '1. 授权工作区', ['选择已有本地目录。', '识别 Git，保留用户已有修改。', '不隐式初始化仓库。'])
    d.box(460, 145, '2. 选择 Agent 配置', ['检查运行条件与登录状态。', '协商并展示实际可用能力。', '不支持的操作保持不可用。'])
    d.box(880, 145, '3. 创建会话', ['绑定一个工作区和一份 Agent 配置。', '受理输入并返回命令回执。', '为受理的本轮输入创建一次执行。'])
    d.arrow([(400,211),(460,211)])
    d.arrow([(820,211),(880,211)])
    d.arrow([(1060,277),(1060,385)])
    d.box(880, 385, '4. 跟进执行', ['流式展示消息和工具活动。', '新输入进入下一轮队列。', '通过有回执的流程取消执行。'])
    d.box(460, 385, '5. 处理人工待办', ['仅在收到真实请求时出现。', '使用原始选项或规定的回答结构。', '多设备只接受一个有效决定。'], fill='#faf5e9', stroke='#e7d8b8')
    d.box(40, 385, '6. 检查结果并继续', ['执行结束与测试成功分别记录。', '检查当前工作区变更。', '继续当前会话，或保留为空闲。'])
    d.arrow([(880,451),(820,451)])
    d.arrow([(460,451),(400,451)])
    d.text(740, 346, '主机持有执行状态与历史记录', 14)
    d.box(40, 580, '桌面与手机共享同一套业务事实', ['可信配对后，设备才能访问指定工作区。', '重连恢复有权查看的历史；离线时不提交审批，也不发送执行命令。'], width=1200, height=116, fill='#f7f7f5')
    d.save()


def control():
    d = Diagram('run-control.svg', '执行与下一轮队列', '同一会话串行受理输入，执行阶段与人工待办分别记录', height=960)
    d.box(40, 145, '设备本地草稿', ['尚未被主机受理。', '离线编辑仍然只是草稿。'], width=340, height=110)
    d.box(470, 145, '主机受理输入', ['校验权限范围与幂等性。', '返回持久化的命令回执。'], width=340, height=110)
    d.arrow([(380,200),(470,200)])
    d.box(900, 145, '会话已有活动执行', ['创建下一轮队列消息。', '不注入当前执行轮次。'], width=340, height=110)
    d.arrow([(810,200),(900,200)])
    d.text(824, 187, '忙碌', 13)
    d.box(470, 340, '执行：排队 / 启动中', ['获取工作区写入租约。', '建立经过验证的 Agent 连接。'], width=340, height=110)
    d.arrow([(640,255),(640,340)])
    d.text(654, 299, '空闲', 13)
    d.box(40, 525, '待处理请求', ['权限审批或补充信息请求。', '提交决定不代表工具执行成功。'], width=340, height=110, fill='#faf5e9', stroke='#e7d8b8')
    d.box(470, 525, '执行：运行中', ['接收流式进展与工具执行更新。', '人工待办单独展示。'], width=340, height=110)
    d.arrow([(640,450),(640,525)])
    d.arrow([(470,554),(380,554)])
    d.arrow([(380,607),(470,607)])
    d.box(900, 525, '执行：取消中', ['向待决请求返回取消结果。', '等待实际终态，并监督进程退出。'], width=340, height=110)
    d.arrow([(810,580),(900,580)])
    d.box(40, 760, '正常完成', ['可以提升下一条队列消息。', '重新检查权限与资源。'], width=340, height=110, fill='#eff6f0', stroke='#d2e4d6')
    d.box(470, 760, '失败 / 中断', ['暂停下一轮队列。', '等待用户显式恢复。'], width=340, height=110)
    d.box(900, 760, '取消，或结束结果先到', ['保留实际观察到的终态。', '受理取消时暂停待执行输入。'], width=340, height=110)
    d.arrow([(550,635),(550,690),(210,690),(210,760)])
    d.arrow([(640,635),(640,760)])
    d.arrow([(1070,635),(1070,760)])
    d.arrow([(1070,255),(1070,300),(855,300),(855,395),(810,395)], dashed=True)
    d.text(900, 332, '仅在安全的轮次切换点提升', 13)
    d.text(40, 922, '撤回与提升采用原子竞争。每个会话最多一个活动执行；工作区租约同时限制并发写入。', 15)
    d.save()


def plugin_runtime():
    d = Diagram('plugin-runtime.svg', '插件运行结构', 'JS 直接开发或 TS 编译为 JS，前端动态注册，后台与 Agent 分别由 Host 管理', height=900)
    d.box(40, 150, '桌面 / 手机 App Host', ['加载 JS，注册 React 组件', 'Registry / Scope / Hook / 服务'], width=300, height=120)
    d.box(400, 150, 'Rust Host 可信内核', ['设备授权、会话调度、审批提交', '数据库事务和持久化事件', '核心决定权不交给插件'], width=440, height=160)
    d.box(900, 150, '插件包', ['plugin.json / dist / Schema', '声明 App、Worker 与贡献绑定', '安装检查不运行任意脚本'], width=340, height=160)
    d.arrow([(340, 210), (400, 210)])
    d.box(400, 380, '插件管理与扩展目录', ['校验、依赖、作用域、版本路由', '原子发布贡献，管理实例与租约', '宿主调用再次检查权限'], width=440, height=160)
    d.arrow([(620, 310), (620, 380)])
    d.arrow([(1070, 310), (1070, 340), (780, 340), (780, 380)])
    d.box(900, 380, 'Node / 可选原生 Worker', ['JS ESM 或 native handler', 'Node 逻辑实例按代次路由', 'stdio RPC，日志进入 stderr'], width=340, height=160)
    d.arrow([(840, 425), (900, 425)])
    d.arrow([(900, 495), (840, 495)])
    d.text(40, 445, 'App 注册、插件 RPC、ACP 分离', 16, '#252622', 600)
    d.text(40, 476, 'Worker 返回启动描述，Host 启动 Agent。', 14)
    d.text(40, 501, '通知与界面扩展失败不阻塞审批事务。', 14)
    d.box(40, 650, 'Host Agent 进程监督', ['根据可信启动描述创建独立进程', '持有 Agent stdio，处理取消与进程树清理', '不混入插件控制协议'], width=500, height=140)
    d.box(740, 650, 'Agent / ACP 桥接程序', ['通过 ACP 收发会话、消息和工具进展', '权限请求回到 Host 可信审批路径', '不把自己的协议输出写入 Worker stdout'], width=500, height=140)
    d.arrow([(500, 310), (500, 340), (370, 340), (370, 620), (290, 620), (290, 650)])
    d.arrow([(540, 700), (740, 700)])
    d.arrow([(740, 755), (540, 755)])
    d.text(580, 683, '独立 ACP 通道', 14)
    d.text(40, 855, 'App 与后台插件均为用户信任的代码；Scope 和共享 Node 实例不等于安全沙箱。', 15)
    d.save()


def plugin_service_boundaries():
    d = Diagram('plugin-service-boundaries.svg', '服务划分与通信协议', '桌面、手机、Rust Host、插件 Worker 与 Agent 的进程边界；以下为目标设计', height=960)
    d.parts.append('<rect x="440" y="135" width="800" height="560" rx="8" fill="#ffffff" stroke="#d3d5cd"/>')
    d.text(460, 165, '同一个 Rust Host 进程，不拆成网络微服务', 17, '#252622', 600)
    d.box(40, 165, '桌面端：Tauri WebView', ['React / App 插件 / SDK', 'Registry 为本地同步注册', '后台调用返回 Promise'], width=300, height=140)
    d.box(40, 340, 'Tauri 原生壳', ['目录选择、托盘、系统通知'], width=300, height=90)
    d.arrow([(190, 305), (190, 340)])
    d.text(207, 327, 'IPC：invoke / Promise', 12)
    d.box(40, 470, '手机端：浏览器 / PWA', ['React / 兼容的 App 插件', '不运行 Node / native Worker', 'HTTPS/WSS · Promise'], width=300, height=140)
    d.box(480, 190, 'API 与事件网关', ['命令与查询：HTTP(S)；事件订阅与推送：WS(S)'], width=700, height=100)
    d.box(480, 340, '插件调度模块', ['贡献目录、实例、代次和路由', '持久化操作状态，管理 Worker', 'Rust 内部 async fn / 事件通道'], width=330, height=135)
    d.box(850, 340, '核心业务与 Agent 接入', ['鉴权、工作区、审批、会话', '反向宿主调用与 Agent 监督', 'Rust 内部 async fn'], width=330, height=135)
    d.box(850, 530, 'SQLite：Host 内嵌存储', ['操作 / 回执 / 事件 / 业务状态', '库调用，不是独立网络服务'], width=330, height=110)
    d.box(480, 735, '后台插件 Worker', ['Node.js 或可选 native 进程', '运行 handler，响应或报告进度', 'Node 可按逻辑实例共享进程'], width=330, height=115)
    d.box(850, 735, 'Agent / ACP 桥接程序', ['独立进程，执行 Coding Agent', '长请求、更新通知与权限请求', '不经过 App 插件或 Worker 中转'], width=330, height=115)
    d.arrow([(340, 225), (480, 225)], color='#486778')
    d.arrow([(480, 260), (340, 260)], dashed=True)
    d.text(347, 211, 'HTTP / WS', 12)
    d.arrow([(340, 535), (395, 535), (395, 275), (480, 275)], color='#486778')
    d.arrow([(480, 285), (415, 285), (415, 575), (340, 575)], dashed=True)
    d.arrow([(645, 290), (645, 340)])
    d.arrow([(1015, 290), (1015, 340)])
    d.arrow([(810, 395), (850, 395)])
    d.arrow([(850, 440), (810, 440)], dashed=True)
    d.arrow([(1015, 475), (1015, 530)])
    d.arrow([(1055, 530), (1055, 475)], dashed=True)
    d.text(1070, 511, 'SQLx await', 12)
    d.arrow([(645, 475), (645, 735)], color='#486778')
    d.arrow([(690, 735), (690, 475)], dashed=True)
    d.text(710, 588, 'stdio JSON-RPC', 13)
    d.text(710, 613, '请求 / 响应 / 通知', 12)
    d.arrow([(1180, 395), (1200, 395), (1200, 715), (1015, 715), (1015, 735)], color='#486778')
    d.arrow([(1065, 735), (1065, 700), (1215, 700), (1215, 440), (1180, 440)], dashed=True)
    d.text(895, 675, 'stdio ACP：长请求 + 更新通知', 13)
    d.text(40, 900, '跨端调用均为异步 I/O；await 只等待结果，不表示阻塞整个界面或 Host。', 15)
    d.text(40, 931, '手机经可信 HTTPS/WSS 入口访问，可由前置 TLS 代理转发；桌面首版统一走 loopback HTTP/WS。', 14)
    d.save()


def plugin_call_flow():
    d = Diagram('plugin-call-flow.svg', '插件后台调用时序', 'HTTP 返回受理回执，业务在后台执行；进度与最终结果经 WS(S) 返回，SDK Promise 等到最终结果才结束', height=1100)
    d.parts.append('<rect x="270" y="125" width="735" height="855" rx="8" fill="#ffffff" stroke="#d3d5cd"/>')
    d.text(290, 148, '同一个 Rust Host 进程：内部调用不经过 HTTP', 13)
    xs = [140, 390, 640, 885, 1130]
    headers = [('桌面 / 手机 App', '浏览器 SDK'), ('API 与事件网关', 'HTTP(S) / WS(S)'), ('插件调度模块', '路由 / 操作状态'), ('宿主业务模块', '文件 / 数据 / 凭据'), ('后台插件 Worker', 'Node.js / native')]
    for x, (title, subtitle) in zip(xs, headers):
        d.box(x-100, 170, title, [subtitle], width=200, height=84)
        d.parts.append(f'<line x1="{x}" y1="254" x2="{x}" y2="960" stroke="#c6c8c0" stroke-dasharray="4 5"/>')
    def message(a, b, y, label, kind='request'):
        color = {'request': '#486778', 'response': '#62645c', 'event': '#32734e'}[kind]
        d.arrow([(xs[a], y), (xs[b], y)], dashed=kind=='response', color=color)
        d.parts.append(f'<text x="{(xs[a]+xs[b])/2}" y="{y-11}" text-anchor="middle" font-size="13" fill="{color}">{escape(label)}</text>')
    message(0, 1, 285, '① HTTP(S) POST：提交插件命令')
    message(1, 2, 340, '② 内部 async fn：校验并记录操作')
    message(2, 1, 385, '返回 operationId', 'response')
    message(1, 0, 430, '③ HTTP 202：仅表示已受理', 'response')
    message(2, 4, 485, '④ stdio JSON-RPC 请求：plugin/invoke')
    message(4, 3, 545, '⑤ 按需反向请求：host/call')
    message(3, 4, 600, 'RPC result / error', 'response')
    message(4, 2, 655, '⑥ 无需响应的通知：plugin/progress', 'event')
    message(2, 1, 710, '落库后，通过内部事件通道发布进度', 'event')
    message(1, 0, 765, '⑦ WS(S) 推送：progress', 'event')
    message(4, 2, 820, '⑧ 原请求的 JSON-RPC result / error', 'response')
    message(2, 1, 875, '落库后，发布 completed / failed 事件', 'event')
    message(1, 0, 930, '⑨ WS(S) 推送：最终结果', 'event')
    d.text(40, 1010, '此时 SDK 才 resolve / reject Promise。蓝色为请求，虚线为响应，绿色为单向事件。', 15)
    d.text(40, 1042, '查询类调用：HTTP 200 返回数据；后台命令：HTTP 202 + operationId，断线后可 GET 查询操作状态。', 14)
    d.text(40, 1072, 'SDK 先建立事件订阅再提交命令，避免漏掉快速结果；已落库的结果也可查询，不仅依赖实时推送。', 14)
    d.save()


if __name__ == '__main__':
    workflow()
    control()
    plugin_runtime()
    plugin_call_flow()
    plugin_service_boundaries()
