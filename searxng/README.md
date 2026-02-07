SearXNG - 尊重隐私的元搜索引擎

此实例配置为仅限本地主机访问。

启动：
  ./compose up -d

停止：
  ./compose down

重启：
  ./compose restart

状态：
  ./compose ps

查看日志：
  ./compose logs -f

访问地址：http://127.0.0.1:8081

配置要求：
- SEARXNG_SECRET_KEY: 环境变量和 settings.yml 中必须设置
- 限流器: 已启用，依赖 Redis
