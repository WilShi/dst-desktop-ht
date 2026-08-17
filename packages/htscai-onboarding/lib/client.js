window.__ModuleLoader__.load({
	id: "dsh-htscai-onboarding",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		/**
		* HTSC AI first-run onboarding, browser half. Registers one
		* 'settings.onboarding' step: collects the company gateway key (stored
		* write-only as HTSCAI_API_KEY), discovers the models that key may serve,
		* attaches the selected models to the htscai route, and seeds the default
		* model selection. Skips itself when the route is absent from the composition
		* or the key is already configured. Chrome is deliberately minimal: one
		* fixed overlay card, inline styles, Chinese copy.
		*/
		/** Settings namespace the pi-ai adapter reads provider profiles from. */
		const PI_AI_NS = "llm-pi-ai";
		/** Credential reference the htscai route resolves per request. */
		const CREDENTIAL_REF = "HTSCAI_API_KEY";
		/** The pre-declared company gateway route. */
		const PROVIDER = "htscai";
		/**
		* Company gateway endpoint, mirrored from the desktop patch's llm-pi-ai row.
		* Discovery passes it explicitly: the wire interrogates the draft endpoint
		* directly rather than resolving the composed profile.
		*/
		const GATEWAY_BASE_URL = "http://168.63.65.40:8090/llm-service/v1";
		/** Wire protocol every model on the gateway speaks. */
		const GATEWAY_API = "openai-completions";
		/** Settings namespace of the default Agent model selection. */
		const DEFAULT_MODEL_NS = "agent-default-model";
		const overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 1e3,
			background: "rgba(0, 0, 0, 0.45)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center"
		};
		const cardStyle = {
			width: 440,
			maxWidth: "92vw",
			maxHeight: "84vh",
			overflowY: "auto",
			background: "#1e1f24",
			color: "#e8e9ec",
			borderRadius: 12,
			padding: "24px 24px 20px",
			boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
			fontSize: 14,
			lineHeight: 1.6
		};
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			marginTop: 8,
			background: "#141518",
			color: "#e8e9ec",
			border: "1px solid #3a3b42",
			borderRadius: 8,
			padding: "8px 10px",
			fontSize: 14,
			outline: "none"
		};
		const primaryButtonStyle = {
			background: "#4d6bfe",
			color: "#fff",
			border: "none",
			borderRadius: 8,
			padding: "8px 16px",
			fontSize: 14,
			cursor: "pointer"
		};
		const ghostButtonStyle = {
			background: "transparent",
			color: "#9a9ba3",
			border: "none",
			padding: "8px 12px",
			fontSize: 13,
			cursor: "pointer"
		};
		/**
		* The one HTSC AI onboarding step.
		* @param props - onboarding coordinator owner props plus the injected wire face.
		* @returns the modal card, or null while readiness loads / when not needed.
		*/
		function HtscaiOnboardingDialog(props) {
			const { complete, api } = props;
			const [phase, setPhase] = (0, react.useState)("loading");
			const [secret, setSecret] = (0, react.useState)("");
			const [busyNote, setBusyNote] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(null);
			const [models, setModels] = (0, react.useState)([]);
			const [checked, setChecked] = (0, react.useState)({});
			(0, react.useEffect)(() => {
				let alive = true;
				(async () => {
					const providers = await api.llm.providers({});
					if (!(providers.result.ok && providers.result.value.providers.some((p) => p.provider === PROVIDER))) {
						complete();
						return;
					}
					const creds = await api.credentials.describe({ refs: [CREDENTIAL_REF] });
					if (creds.result.ok && creds.result.value.credentials[CREDENTIAL_REF]?.configured === true) {
						complete();
						return;
					}
					if (alive) setPhase("input");
				})().catch(() => complete());
				return () => {
					alive = false;
				};
			}, [api, complete]);
			(0, react.useEffect)(() => {
				if (phase === "loading") return;
				const root = document.getElementById("root");
				root?.setAttribute("inert", "");
				return () => root?.removeAttribute("inert");
			}, [phase]);
			const saveAndDiscover = async () => {
				setError(null);
				setPhase("busy");
				setBusyNote("正在验证密钥并查询可用模型…");
				const found = await api.llm.discoverModels({
					settingsNs: PI_AI_NS,
					provider: PROVIDER,
					baseURL: GATEWAY_BASE_URL,
					api: GATEWAY_API,
					apiKey: secret.trim()
				});
				if (!found.result.ok) {
					setPhase("input");
					setError("查询失败：" + found.result.error.message + "。请确认密钥正确且当前在公司内网。");
					return;
				}
				setBusyNote("正在保存密钥…");
				const stored = await api.credentials.set({
					ref: CREDENTIAL_REF,
					value: secret.trim()
				});
				if (!stored.result.ok) {
					setPhase("input");
					setError("密钥保存失败：" + stored.result.error.message);
					return;
				}
				const list = found.result.value.models;
				if (list.length === 0) {
					setPhase("input");
					setError("该密钥下没有可用模型。密钥已保存，可稍后在「设置 → 模型」里配置。");
					return;
				}
				setModels(list);
				setChecked(Object.fromEntries(list.map((m) => [m.id, true])));
				setPhase("models");
			};
			const attachModels = async () => {
				const chosen = models.filter((m) => checked[m.id]);
				setError(null);
				setPhase("busy");
				setBusyNote("正在写入模型配置…");
				const write = await api.settings.mutate({
					ns: PI_AI_NS,
					ops: [{
						op: "set",
						path: [
							"providers",
							PROVIDER,
							"models"
						],
						value: chosen.map((m) => ({
							id: m.id,
							...m.contextWindow !== void 0 ? { contextWindow: m.contextWindow } : {},
							...m.maxTokens !== void 0 ? { maxTokens: m.maxTokens } : {}
						}))
					}]
				});
				if (!write.result.ok) {
					setPhase("models");
					setError("模型配置写入失败：" + write.result.error.message + "。可稍后在「设置 → 模型」里手动添加。");
					return;
				}
				if (chosen.length > 0) await api.settings.mutate({
					ns: DEFAULT_MODEL_NS,
					ops: [{
						op: "set",
						path: ["provider"],
						value: PROVIDER
					}, {
						op: "set",
						path: ["model"],
						value: chosen[0].id
					}]
				}).catch(() => void 0);
				complete();
			};
			if (phase === "loading") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: cardStyle,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 17,
								fontWeight: 600,
								marginBottom: 8
							},
							children: "配置 HTSC AI 密钥"
						}),
						phase === "input" || phase === "busy" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									margin: "0 0 4px",
									color: "#b9bac2"
								},
								children: "请输入公司内部 HTSC AI 网关的密钥。密钥只保存在本机凭证库，不会写入任何配置文件。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: inputStyle,
								type: "password",
								placeholder: "HTSCAI_API_KEY",
								value: secret,
								autoFocus: true,
								disabled: phase === "busy",
								onChange: (event) => setSecret(event.target.value),
								onKeyDown: (event) => {
									if (event.key === "Enter" && secret.trim() !== "" && phase !== "busy") saveAndDiscover();
								}
							}),
							error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									color: "#ff7a7a",
									margin: "10px 0 0"
								},
								children: error
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									marginTop: 18,
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...primaryButtonStyle,
										opacity: phase === "busy" || secret.trim() === "" ? .5 : 1
									},
									disabled: phase === "busy" || secret.trim() === "",
									onClick: () => void saveAndDiscover(),
									children: phase === "busy" ? busyNote : "保存并查询可用模型"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: ghostButtonStyle,
									disabled: phase === "busy",
									onClick: () => complete(),
									children: "稍后再说"
								})]
							})
						] }) : null,
						phase === "models" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: {
									margin: "0 0 10px",
									color: "#b9bac2"
								},
								children: [
									"查询到 ",
									models.length,
									" 个可用模型，勾选要加入配置的："
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 6,
									marginBottom: 14
								},
								children: models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 8,
										cursor: "pointer"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: checked[m.id] === true,
											onChange: (event) => setChecked((prev) => ({
												...prev,
												[m.id]: event.target.checked
											}))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: m.name ?? m.id }),
										m.name !== void 0 && m.name !== m.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												color: "#777883",
												fontSize: 12
											},
											children: m.id
										}) : null
									]
								}, m.id))
							}),
							error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									color: "#ff7a7a",
									margin: "0 0 10px"
								},
								children: error
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...primaryButtonStyle,
										opacity: models.some((m) => checked[m.id]) ? 1 : .5
									},
									disabled: !models.some((m) => checked[m.id]),
									onClick: () => void attachModels(),
									children: "加入配置"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: ghostButtonStyle,
									onClick: () => complete(),
									children: "跳过"
								})]
							})
						] }) : null
					]
				})
			});
		}
		/** Required services: the slot registry and the connection carrying the wire API. */
		const inject = ["slots", "connection"];
		/**
		* Client plugin body: register the HTSC AI step into the onboarding
		* coordinator once the settings shell has declared the slot.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const connection = ctx.get("connection");
			ctx.slots.inject("settings.onboarding", () => ctx.slots.register({
				name: "settings.onboarding",
				id: "htscai-key",
				order: 0,
				inject: () => ({ api: connection.api })
			}, HtscaiOnboardingDialog));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map