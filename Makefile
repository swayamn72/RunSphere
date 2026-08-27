COMPOSE := docker compose --env-file .env -f infra/compose.yaml

.PHONY: infra-validate infra-up infra-demo infra-maps infra-routing infra-ops infra-scale infra-down infra-logs infra-reset

infra-validate: ## Validate .env values and render Compose configuration.
	./infra/scripts/validate-config.sh

infra-up: infra-validate ## Start the local PostGIS database.
	$(COMPOSE) --profile local up -d postgres

infra-demo: infra-validate ## Start the demo profile (currently PostGIS only).
	$(COMPOSE) --profile demo up -d

infra-maps: infra-validate ## Start PostGIS and the Martin vector-tile placeholder.
	$(COMPOSE) --profile maps up -d

infra-routing: infra-validate ## Start PostGIS and the Valhalla routing placeholder.
	$(COMPOSE) --profile routing up -d

infra-ops: infra-validate ## Start PostGIS and local-only pgAdmin.
	$(COMPOSE) --profile ops up -d

infra-scale: infra-validate ## Render the future scaling profile; replica is a placeholder.
	$(COMPOSE) --profile scale up -d

infra-down: ## Stop containers while retaining named data volumes.
	$(COMPOSE) --profile local --profile demo --profile maps --profile routing --profile ops --profile scale down

infra-logs: ## Follow logs from all configured infrastructure services.
	$(COMPOSE) --profile local --profile demo --profile maps --profile routing --profile ops --profile scale logs -f

infra-reset: ## Stop infrastructure and delete local named volumes.
	$(COMPOSE) --profile local --profile demo --profile maps --profile routing --profile ops --profile scale down --volumes
