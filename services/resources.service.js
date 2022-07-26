"use strict";
const { generateUid } = require("./uid");
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "resources",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2", "search"],

	/**
	 * Actions
	 */
	actions: {
		Patient: {
			async handler(ctx) {
				const { Patient: patient } = ctx.params;
				try {
					const trackedEntityType = await ctx.call("search.entity");
					if (trackedEntityType) {
						const orgUnit = await ctx.call(
							"search.facility",
							patient.managingOrganization
						);
						if (orgUnit) {
							const { identifiers, biodata } = await ctx.call(
								"search.patient",
								patient
							);
							const identifierValues = identifiers.map((i) => i.value);
							if ([...identifierValues, ...biodata].length > 0 || patient.id) {
								let trackedEntityInstance = {
									trackedEntityType,
									orgUnit,
									attributes: [...identifiers, ...biodata],
								};

								let toBeIndexed = {
									attributes: identifierValues,
									enrollments: [],
									encounters: [],
								};

								if (patient.id) {
									toBeIndexed = { ...toBeIndexed, id: patient.id };
								}
								const previousPatient = await ctx.call(
									"search.previousPatient",
									{
										id: patient.id,
										identifiers: identifierValues,
									}
								);

								if (previousPatient) {
									toBeIndexed = {
										...previousPatient,
										attributes: identifierValues,
									};
									if (patient.id) {
										toBeIndexed = {
											...previousPatient,
											attributes: identifierValues,
											id: patient.id,
										};
									}
									trackedEntityInstance = {
										...trackedEntityInstance,
										trackedEntityInstance:
											previousPatient.trackedEntityInstance,
									};
								} else {
									const code = generateUid();
									trackedEntityInstance = {
										...trackedEntityInstance,
										trackedEntityInstance: code,
									};
									toBeIndexed = {
										...toBeIndexed,
										trackedEntityInstance: code,
									};
								}
								const response = await ctx.call("dhis2.post", {
									url: "trackedEntityInstances",
									...trackedEntityInstance,
								});
								const response2 = await ctx.call("es.bulk", {
									index: "patients",
									dataset: [toBeIndexed],
									idField: "trackedEntityInstance",
								});
								return response;
							}
						}
					}
				} catch (error) {
					return error.message;
				}
			},
		},
		EpisodeOfCare: {
			async handler(ctx) {
				const {
					EpisodeOfCare: {
						id,
						type: [
							{
								coding: [{ system, code, display }],
							},
						],
						period: { start },
						patient: { identifier, reference },
						managingOrganization,
					},
				} = ctx.params;

				let patient = {
					identifier: [],
				};
				if (reference) {
					patient = {
						...patient,
						id: String(reference).replace("Patient/", ""),
					};
				}

				if (identifier) {
					patient = {
						...patient,
						identifiers: identifier.map((id) => id.value),
					};
				}

				const program = await ctx.call("search.program", {
					system: system || display,
					code,
				});

				const orgUnit = await ctx.call("search.facility", managingOrganization);

				if (program !== null && orgUnit !== null) {
					const previousPatient = await ctx.call(
						"search.previousPatient",
						patient
					);

					if (previousPatient !== null) {
						const { enrollments, trackedEntityInstance } = previousPatient;
						const previousEnrollment = enrollments.find((e) => {
							return (e.enrollmentDate =
								start &&
								e.program === program &&
								e.orgUnit === orgUnit &&
								e.id === id);
						});

						if (!previousEnrollment) {
							const enrollment = generateUid();
							const enroll = {
								enrollment,
								enrollmentDate: start,
								incidentDate: start,
								orgUnit,
								trackedEntityInstance,
								program,
							};
							const response = await ctx.call("dhis2.post", {
								url: "enrollments",
								...enroll,
							});
							const response2 = await ctx.call("es.bulk", {
								index: "patients",
								dataset: [
									{
										...previousPatient,
										enrollments: [...enrollments, { ...enroll, id }],
									},
								],
								idField: "trackedEntityInstance",
							});
							return response;
						} else {
							return { message: "Already enrolled" };
						}
					}
				}
			},
		},
		Encounter: {
			async handler(ctx) {
				try {
					const {
						Encounter: {
							id,
							type: [
								{
									coding: [{ system, code }],
								},
							],
							period: { start },
							subject: { reference, identifier },
							serviceProvider,
							episodeOfCare,
						},
					} = ctx.params;

					const programStage = await ctx.call("search.stage", { system, code });
					const orgUnit = await ctx.call("search.facility", serviceProvider);

					if (programStage !== null && orgUnit !== null) {
						let patient = {
							identifier: [],
						};
						if (reference) {
							patient = {
								...patient,
								id: String(reference).replace("Patient/", ""),
							};
						}
						if (identifier) {
							patient = {
								...patient,
								identifiers: identifier.map((id) => id.value),
							};
						}
						const previousPatient = await ctx.call(
							"search.previousPatient",
							patient
						);

						if (previousPatient !== null) {
							const { enrollments, trackedEntityInstance, encounters } =
								previousPatient;

							const previousEnrollment = enrollments.find((e) => {
								return (
									e.id ===
									String(episodeOfCare.reference).replace("EpisodeOfCare/", "")
								);
							});
							if (previousEnrollment && programStage !== null) {
								const { program, enrollment } = previousEnrollment;
								const previousEncounter = encounters.find((e) => {
									return (e.eventDate =
										start &&
										e.program === program &&
										e.orgUnit === orgUnit &&
										e.id === id);
								});
								if (!previousEncounter) {
									const event = generateUid();
									const encounter = {
										event,
										trackedEntityInstance,
										orgUnit,
										eventDate: start,
										program,
										programStage,
										enrollment,
									};
									const response = await ctx.call("dhis2.post", {
										url: "events",
										...encounter,
										dataValues: [],
									});
									const response2 = await ctx.call("es.bulk", {
										index: "patients",
										dataset: [
											{
												...previousPatient,
												encounters: [...encounters, { ...encounter, id }],
											},
										],
										idField: "trackedEntityInstance",
									});
									return response;
								}
							}
						}
					}

					return "No record was inserted some information is missing";
				} catch (error) {
					return error.message;
				}
			},
		},
		Observation: {
			async handler(ctx) {
				try {
					const {
						Observation: {
							subject,
							encounter,
							code: { coding },
							valueQuantity,
							valueCodeableConcept,
							valueString,
							valueBoolean,
							valueInteger,
							valueTime,
							valueDateTime,
						},
					} = ctx.params;
					let realValue =
						valueString ||
						valueBoolean ||
						valueInteger ||
						valueTime ||
						valueDateTime;
					if (valueQuantity) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept) {
						const valueCode = valueCodeableConcept.coding.find(
							(code) => !!code.system
						);
						if (valueCode) {
							const searchCodeableConcept = await ctx.call("search.option", {
								system: valueCode.system,
								code: valueCode.code,
							});
							if (searchCodeableConcept) {
								realValue = searchCodeableConcept;
							} else {
								realValue = valueCode.code;
							}
						}
					}
					const foundMapping = coding.find(
						(code) => !!code.system && !!code.code
					);
					if (realValue) {
						if (foundMapping) {
							const { system, code } = foundMapping;
							const dataElement = await ctx.call("search.concept", {
								system,
								code,
							});

							let patient = {
								identifier: [],
							};
							if (subject.reference) {
								patient = {
									...patient,
									id: String(subject.reference).replace("Patient/", ""),
								};
							}
							if (subject.identifier) {
								patient = {
									...patient,
									identifiers: subject.identifier.map((id) => id.value),
								};
							}
							if (dataElement) {
								const previousPatient = await ctx.call(
									"search.previousPatient",
									patient
								);
								if (previousPatient) {
									const { encounters } = previousPatient;
									const previousEncounter = encounters.find((e) => {
										return (
											e.id ===
											String(encounter.reference).replace("Encounter/", "")
										);
									});
									if (previousEncounter) {
										const {
											id,
											event,
											orgUnit,
											program,
											programStage,
											trackedEntityInstance,
										} = previousEncounter;

										console.log({
											url: `events/${event}/${dataElement}`,
											event,
											orgUnit,
											program,
											programStage,
											trackedEntityInstance,
											status: "ACTIVE",
											dataValues: [{ dataElement, value: realValue }],
										});
										return await ctx.call("dhis2.put", {
											url: `events/${event}/${dataElement}`,
											event,
											orgUnit,
											program,
											programStage,
											trackedEntityInstance,
											status: "ACTIVE",
											dataValues: [{ dataElement, value: realValue }],
										});
									} else {
										return `Could not find encounter ${String(
											encounter.reference
										).replace("Encounter/", "")}`;
									}
								} else {
									return `Could not find patient ${String(
										subject.reference
									).replace("Patient/", "")}`;
								}
							} else {
								return `Could not find mapping for ${code}`;
							}
						} else {
							return `Could not find mapping system and code`;
						}
					} else {
						return "No value found for specified observation";
					}
				} catch (error) {
					return error.message;
				}
			},
		},
	},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {},

	/**
	 * Service created lifecycle event handler
	 */
	created() {},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {},
};
