#!/usr/bin/env python3
"""Generate editable, self-contained SVG design diagrams; standard library only."""
from pathlib import Path
from html import escape
from math import hypot

OUT = Path(__file__).resolve().parents[1] / 'diagrams'
INK = '#172033'
MUTED = '#536174'
LINE = '#CBD5E1'
BG = '#F6F7FB'
BLUE = '#4338CA'
PALE = '#EEF2FF'
AMBER = '#92400E'
WARM = '#FFF7ED'
GREEN = '#166534'
RED = '#B91C1C'


class Svg:
    def __init__(self, name, width, height, title, subtitle):
        self.name, self.w, self.h = name, width, height
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{escape(title)}</title><desc id="desc">{escape(subtitle)}</desc>',
                      '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L8 4.5 L1 8" fill="none" stroke="#64748B" stroke-width="1.5"/></marker></defs>',
                      '<style>text{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif} .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style>']
        self.rect(0, 0, width, height, BG, radius=0)
        self.text(40, 43, 'VIBEONE  /  DESIGN SPECIFICATION', 12, MUTED, 600)
        self.text(40, 88, title, 30, INK, 600)
        self.text(40, 119, subtitle, 16, MUTED)

    def rect(self, x, y, w, h, fill='white', stroke='none', radius=12):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}"/>')

    def text(self, x, y, text, size=16, color=INK, weight=400, anchor='start', mono=False):
        self.parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}"'+(' class="mono"' if mono else '')+f'>{escape(str(text))}</text>')

    def line(self, x1, y1, x2, y2, color=LINE, dash=False):
        self.parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5"'+(' stroke-dasharray="5 5"' if dash else '')+'/>')

    def path(self, points, arrow=True, dash=False, color='#64748B'):
        d = 'M' + ' L'.join(f'{x},{y}' for x, y in points)
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.5" stroke-linejoin="round"'+(' stroke-dasharray="6 5"' if dash else '')+'/>')
        # Explicit arrowheads also render in native SVG viewers without marker support.
        if arrow:
            x0,y0=next(p for p in reversed(points[:-1]) if p != points[-1])
            x,y=points[-1]
            length=hypot(x-x0,y-y0)
            ux,uy=(x-x0)/length,(y-y0)/length
            a=(x-8*ux+4*uy,y-8*uy-4*ux)
            b=(x-8*ux-4*uy,y-8*uy+4*ux)
            self.parts.append(f'<path d="M{a[0]},{a[1]} L{x},{y} L{b[0]},{b[1]}" fill="none" stroke="{color}" stroke-width="1.5" stroke-linejoin="round"/>')

    def box(self, x, y, w, title, lines=(), fill='white', h=92, tag=None):
        self.rect(x, y, w, h, fill, '#E2E8F0')
        self.text(x+18, y+29, title, 18, INK, 600)
        for i, text in enumerate(lines):
            self.text(x+18, y+54+i*23, text, 14, MUTED)
        if tag:
            self.text(x+w-18, y+29, tag, 12, MUTED, anchor='end')

    def pill(self, x, y, text, w=90, fill=PALE, color=BLUE):
        self.rect(x, y, w, 27, fill, radius=7)
        self.text(x+w/2, y+18, text, 13, color, 500, 'middle')

    def button(self, x, y, w, label, primary=False, h=38):
        self.rect(x, y, w, h, BLUE if primary else 'white', 'none' if primary else LINE, 8)
        self.text(x+w/2, y+h/2+5, label, 14, 'white' if primary else INK, 500, 'middle')

    def note(self, x, y, w, title, detail, fill=PALE):
        self.rect(x, y, w, 76, fill, radius=10)
        self.text(x+16, y+28, title, 16, INK, 600)
        self.text(x+16, y+53, detail, 14, MUTED)

    def save(self):
        self.line(40, self.h-43, self.w-40, self.h-43)
        self.text(40, self.h-19, '目标设计 · 2026-11-05 · 状态与数据均为示例', 12, MUTED)
        self.text(self.w-40, self.h-19, self.name, 12, MUTED, anchor='end')
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / (self.name+'.svg')).write_text('\n'.join(self.parts)+ '\n</svg>\n')


def architecture():
    s = Svg('system-architecture', 1440, 1110, '系统架构与状态归属', '客户端负责呈现与意图；Rust Host 管理运行事实、审批、扩展和持久化。')
    s.box(70, 165, 350, '桌面客户端', ['Tauri 窗口 / 托盘 / 系统通知', 'React 工作台 / JS App 动态注册'], h=110)
    s.box(520, 165, 350, '手机客户端', ['Web / PWA · 单列任务与审批', '加载兼容 App，不运行本机 Worker'], h=110)
    s.box(970, 165, 350, '设备与连接', ['单次配对 / 工作区角色 / 撤销', 'HTTPS / WSS / 断线续传'], h=110)
    s.path([(245, 275), (245, 308)])
    s.path([(695, 275), (695, 308)])
    s.path([(1145, 275), (1145, 308)])
    s.rect(60, 318, 1320, 422, 'white', '#D6DCE8', 16)
    s.text(84, 352, 'RUST HOST  ·  唯一状态写入者', 18, INK, 600)
    s.box(90, 378, 1260, '应用服务与认证网关', ['命令校验 / 幂等回执 / 授权检查 / 查询与事件订阅'], PALE, 86)
    for x, title, detail in [(100,'会话与 Run Actor','串行协调 / 状态机'),(430,'审批中心','唯一决定 / 投递状态'),(760,'插件内核','目录 / 依赖 / generation'),(1090,'工作区服务','目录授权 / Git')]:
        s.path([(x+120, 464), (x+120, 497)])
        s.box(x, 500, 240, title, [detail], h=85)
    s.box(100, 630, 570, 'ACP Client + Supervisor', ['协议握手 / 双向请求 / 取消 / 进程树回收'], h=83)
    s.box(760, 630, 570, '事务提交与事件投递', ['领域状态 + events + outbox → 已提交事件'], h=83)
    s.path([(220,585),(220,620)])
    s.path([(550,585),(550,610),(385,610),(385,620)])
    s.path([(880,585),(880,620)])
    s.path([(1210,585),(1210,620)])
    s.box(80, 805, 370, 'Agent 执行进程', ['原生 ACP / 显式协议桥接器', '由 Host 持有会话连接和进程'], h=112)
    s.box(535, 805, 370, 'Node / 可选 native Worker', ['JS 或 TS 编译后的 JS', '后台逻辑通过版本化 RPC 调用'], h=112)
    s.box(990, 805, 370, '本地存储', ['SQLite WAL / 快照 / 回执', '附件文件 / secret_id 引用'], h=112)
    s.path([(265,713),(265,795)])
    s.path([(880,585),(1388,585),(1388,770),(720,770),(720,795)])
    s.path([(1175,713),(1175,795)])
    s.note(80, 950, 1280, '提交之后再广播', '状态先落库；桌面、手机、通知与插件消费同一条已提交事件流。')
    s.save()


def approval():
    s = Svg('approval-sequence', 1480, 1110, '跨设备审批与唯一决定', 'Host 保存原始请求；桌面与手机提交意图；原子版本检查决定谁先成功。')
    xs=[150,450,750,1050,1340]
    for x,t in zip(xs,['Agent','Rust Host','SQLite / Outbox','桌面','手机']):
        s.rect(x-90,164,180,54,'white','#E2E8F0',10)
        s.text(x,197,t,17,INK,600,'middle')
        s.line(x,228,x,880,LINE,True)
    def msg(a,b,y,label,dash=False):
        s.path([(xs[a],y),(xs[b]-9 if b>a else xs[b]+9,y)],dash=dash)
        s.text((xs[a]+xs[b])/2,y-12,label,14,MUTED,anchor='middle')
    msg(0,1,273,'请求工具权限 + 原始选项')
    msg(1,2,343,'事务：pending + event + outbox')
    msg(2,1,400,'提交成功',True)
    msg(1,3,465,'广播待审批事件',True)
    msg(1,4,523,'广播待审批事件',True)
    msg(4,1,590,'允许一次 · request version=1')
    msg(1,2,657,'CAS：pending → decision_recorded')
    msg(2,1,713,'唯一决定提交成功',True)
    msg(3,1,773,'晚到拒绝 · version=1')
    msg(1,3,825,'冲突：展示已生效决定',True)
    msg(1,0,883,'返回上游选项 · 记录 response_sent')
    s.note(60,920,650,'竞争与投递分开记录','先提交的决定生效；本地写出成功不代表工具执行成功。')
    s.note(740,920,680,'重启或连接 epoch 改变','旧请求失效；回传前崩溃记录 delivery_unknown，不重放。',WARM)
    s.save()


def plugins():
    s = Svg('plugin-lifecycle', 1380, 1080, '插件激活、更新与排空', '先准备候选，再原子发布贡献目录；活动 Agent 会话绑定自己的版本。')
    s.box(60,170,370,'01  检查安装包',['身份 / 平台 / 路径 / digest','配置 Schema / 兼容版本 / 依赖'],h=112)
    s.box(505,170,370,'02  创建候选代',['不替换当前 active','准备配置迁移与贡献绑定'],PALE,112)
    s.box(950,170,370,'当前 active 继续服务',['候选失败时保持可用','显示失败原因与重试入口'],h=112)
    s.path([(430,226),(495,226)])
    s.box(290,365,350,'App / 声明式贡献',['JS 模块动态注册 / Schema 表单','客户端维护 Registry 与 Scope'],h=112)
    s.box(740,365,350,'Node / 可选 native Worker',['准备实例 → 握手 → handler 核验','超时 / 取消 / stderr 日志'],h=112)
    s.path([(640,282),(640,325),(465,325),(465,355)])
    s.path([(740,282),(740,325),(915,325),(915,355)])
    s.text(700,323,'按 binding 选择',14,MUTED,anchor='middle')
    s.box(505,555,370,'03  原子发布目录',['整个 contribution 集合一起出现','catalog revision + generation'],PALE,112)
    s.path([(465,477),(465,515),(610,515),(610,545)])
    s.path([(915,477),(915,515),(770,515),(770,545)])
    s.box(60,760,370,'新会话与未绑定调用使用新代',['旧会话后续 Run 仍使用旧代','禁用后拒绝新的调用'],h=112)
    s.box(505,760,370,'旧代等待已有 lease',['短调用可限时排空','长会话等待完成或显式停止'],WARM,112)
    s.box(950,760,370,'04  释放旧代',['逆序清理订阅 / 注册 / 任务','保留用户配置与历史'],h=112)
    s.path([(590,667),(590,710),(245,710),(245,750)])
    s.path([(690,667),(690,750)])
    s.path([(875,816),(940,816)])
    s.path([(1090,420),(1135,420),(1135,292)],dash=True)
    s.text(1195,440,'候选失败',14,MUTED,anchor='middle')
    s.text(1195,464,'保留旧版',14,MUTED,anchor='middle')
    s.note(60,915,1260,'执行与 UI 生命周期独立','后台 Worker 留在 Host；手机加载兼容的浏览器 App 产物，不执行 Node 或原生程序。')
    s.save()


def reconnect():
    s=Svg('reconnect-flow',1320,1030,'断线恢复与事件连续性','客户端恢复可信状态后再开放操作；离线草稿与已提交命令分开处理。')
    s.box(60,175,340,'连接断开',['保留只读快照与草稿','显示最后同步时间，禁用写操作'],h=110)
    s.box(490,175,340,'认证重连',['host_id / epoch / cursor','验证设备、角色与工作区范围'],h=110)
    s.box(920,175,340,'设备已撤销',['关闭连接，清除敏感缓存','回到配对入口'],WARM,110)
    s.path([(400,230),(480,230)])
    s.path([(830,230),(910,230)])
    s.text(874,212,'拒绝',13,MUTED,anchor='middle')
    s.box(60,405,340,'cursor 有效',['按授权续传后续事件','event_id 去重 / 检测缺口'],h=110)
    s.box(490,405,340,'cursor 过期',['一致性快照 + high-water mark','切换到边界之后的事件'],PALE,110)
    s.box(920,405,340,'epoch 已改变',['重新读取 Run 与审批状态','清除旧 pending 临时回执'],h=110)
    for x in [230,660,1090]:
        s.path([(660,285),(660,340),(x,340),(x,395)])
    s.box(490,635,340,'应用客户端投影',['快照切换与事件消费连续','检查在途命令回执，不重复创建'],PALE,110)
    for x in [230,660,1090]: s.path([(x,515),(x,565),(660,565),(660,625)])
    s.box(490,815,340,'恢复可操作界面',['当前状态可信且在线','审批必须重新校验有效性'],h=100)
    s.path([(660,745),(660,805)])
    s.note(60,815,340,'在途命令','先查回执，再决定是否重试。')
    s.note(920,815,340,'连续性保护','切流漏事件时立即重新同步。')
    s.save()


if __name__ == '__main__':
    for render in [architecture, approval, plugins, reconnect]:
        render()
    print(f'Generated 4 SVG files in {OUT}')
