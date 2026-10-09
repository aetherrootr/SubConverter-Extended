#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <limits>
#include <sstream>

#include "config/binding.h"
#include "generator/config/clash_health_check.h"

int main() {
  for (const std::string type : {"url-test", "load-balance", "fallback", "smart"}) {
    for (const bool lazy : {false, true}) {
      std::istringstream source(
          "name = 'TW'\ntype = '" + type +
          "'\nurl = 'https://example.test/204'\ninterval = 60\n"
          "rule = ['.*']\ntimeout = 2\nlazy = " +
          (lazy ? "true\n" : "false\n"));
      const auto group = toml::from<ProxyGroupConfig>::from_toml(
          toml::parse(source, "health-check.toml"));
      YAML::Node output;
      applyClashGroupHealthCheck(output, group);
      assert(output["lazy"].as<bool>() == lazy);
      assert(output["timeout"].as<int64_t>() == 2000);
    }
  }

  std::istringstream source(
      "name = 'TW'\ntype = 'fallback'\nurl = 'https://example.test/204'\n"
      "interval = 30\nrule = ['.*']\n");
  const auto defaults = toml::from<ProxyGroupConfig>::from_toml(
      toml::parse(source, "defaults.toml"));
  YAML::Node output;
  applyClashGroupHealthCheck(output, defaults);
  assert(!output["lazy"]);
  assert(output["timeout"].as<int>() == 5000);

  ProxyGroupConfig limits;
  limits.Timeout = std::numeric_limits<Integer>::max();
  applyClashGroupHealthCheck(output, limits);
  assert(output["timeout"].as<int64_t>() == 2147483647000LL);
  limits.Timeout = 0;
  YAML::Node unset;
  applyClashGroupHealthCheck(unset, limits);
  assert(!unset["timeout"]);

  const auto base = YAML::Load(
      "Airport:\n  health-check:\n    timeout: 2000\n    lazy: false\n"
      "    interval: 60\n    expected-status: 204\n"
      "Disabled:\n  health-check:\n    enable: false\n");
  YAML::Node provider = YAML::Load(
      "type: http\nurl: https://example.test/sub\nhealth-check:\n"
      "  enable: true\n  url: https://example.test/204\n  interval: 300\n");
  preserveClashProviderHealthCheck(provider, base, "Airport");
  assert(provider["health-check"]["enable"].as<bool>());
  assert(provider["health-check"]["url"].as<std::string>() ==
         "https://example.test/204");
  assert(provider["health-check"]["timeout"].as<int>() == 2000);
  assert(!provider["health-check"]["lazy"].as<bool>());
  assert(provider["health-check"]["interval"].as<int>() == 60);
  assert(provider["health-check"]["expected-status"].as<int>() == 204);
  provider["health-check"]["timeout"] = 3000;
  assert(base["Airport"]["health-check"]["timeout"].as<int>() == 2000);
  preserveClashProviderHealthCheck(provider, base, "Disabled");
  assert(!provider["health-check"]["enable"].as<bool>());
  preserveClashProviderHealthCheck(provider, base, "Missing");
  preserveClashProviderHealthCheck(provider, YAML::Node(), "Airport");
}
