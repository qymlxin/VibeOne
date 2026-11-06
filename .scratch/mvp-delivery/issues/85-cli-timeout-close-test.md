# 85 · CLI 超时连接关闭断言
Status: resolved
Type: task

## 范围

84全量检查中，CLI超时测试服务端读到真实ConnectionReset，却把它视为断言失败。修正测试以完整读取请求头，并接受EOF或明确的连接重置/中止；其他错误、额外字节和未关闭仍失败。不修改生产CLI行为或放宽请求期限。

## Answer

服务端完整读取请求头，超时后只接受EOF、ConnectionReset或ConnectionAborted，额外字节和其他错误仍失败；连接关闭等待还有独立上限。生产CLI及25秒请求期限未修改。修复前全量检查复现macOS code54，修复后该真实TCP/虚拟时钟测试连续三次通过。
