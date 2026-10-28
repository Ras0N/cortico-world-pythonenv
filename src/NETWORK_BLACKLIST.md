# Python Env · 网络黑名单
#
# 在本 World 的「提示词」页编辑并保存（与环境提示词同级）。
# 每行一个域名或后缀；以 # 开头的行为注释，可忽略。
# 也可用逗号写在同一行。空文件 = 不额外拦截主机名。
#
# 后缀示例（匹配该后缀及子域）：
#   .internal
#   .corp.example
# 精确主机：
#   evil.example.com
#
# 由工具参数扫描与 venv 内 pythonenv_hooks 执行；改后下次命令即生效，无需重启 World。
