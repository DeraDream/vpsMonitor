# VPS Monitor v1.4.2

GreenCloud 套餐浏览和监控编辑列表明确提供“查看套餐购买页”入口。链接继续使用官网套餐卡片提供的 href；不同套餐保留各自路径，不按显示名称拼接，不替换为分类页。Telegram 卡片也使用同一个 buyUrl。

对照访问：Budget KVM Sale 分类中的 BudgetKVMMO-2 当次显示 5 台库存，保留临时会话 Cookie 后购买链接跳转到包含该套餐的 Review & Checkout；BudgetKVMNYC-2 当次显示 0 台，产品购买页显示 Out of Stock。未提交订单或支付。大写 BudgetKVMMO-2 与官网小写 budgetkvmmo-2 两个地址均在当次会话中有效。库存以后仍以官网返回为准。

自动监控继续读取分类页；购买页访问仅用于本次对照验证，没有增加每轮四百余次购物车请求。71 项后端测试、13 项 GreenCloud 浏览器检查及 5 项线上检查通过；本地安装包校验、解压运行验证通过。当前 VPS 已更新到 1.4.2，保留现有监控范围和 Telegram 设置。
