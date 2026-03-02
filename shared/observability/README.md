# observability/

本目录存放可观测性相关配置 (例如 Prometheus scrape 配置)。

注意:
- 变更监控项时, 尽量不影响服务接口契约。
- 若需要新增 metrics 或调整 metrics_path, 同步更新相关文档与部署说明。
