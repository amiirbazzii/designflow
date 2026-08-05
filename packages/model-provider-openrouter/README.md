# `@designflow/model-provider-openrouter`

Owns the OpenRouter model-provider adapter and its transport-specific
translation into DesignFlow model contracts.

It must not own agent policy, workflow definitions, or CLI configuration.
Construct it only from a composition root and import it through the package
root; domain packages should depend on SDK model ports instead.
