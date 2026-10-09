#ifndef CLASH_HEALTH_CHECK_H_INCLUDED
#define CLASH_HEALTH_CHECK_H_INCLUDED

#include <cstdint>
#include <yaml-cpp/yaml.h>

#include "config/proxygroup.h"

inline void applyClashGroupHealthCheck(YAML::Node &output,
                                      const ProxyGroupConfig &group) {
  if (!group.Lazy.is_undef())
    output["lazy"] = group.Lazy.get();
  // Group timeouts in subconverter are seconds, unlike Mihomo milliseconds.
  if (group.Timeout > 0)
    output["timeout"] = static_cast<int64_t>(group.Timeout) * 1000;
}

inline void preserveClashProviderHealthCheck(YAML::Node &output,
                                             const YAML::Node &base_providers,
                                             const std::string &name) {
  // Multiple groups can share this provider. Its explicit base-template policy
  // wins over generated defaults, independently of any one group's settings.
  if (!base_providers || !base_providers.IsMap())
    return;
  const YAML::Node provider = base_providers[name];
  if (!provider || !provider.IsMap())
    return;
  const YAML::Node health_check = provider["health-check"];
  if (!health_check || !health_check.IsMap())
    return;
  for (const auto &entry : health_check)
    output["health-check"][entry.first.as<std::string>()] =
        YAML::Clone(entry.second);
}

#endif
