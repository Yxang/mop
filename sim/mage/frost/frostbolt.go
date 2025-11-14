package frost

import (
	"time"

	"github.com/wowsims/mop/sim/core"
	"github.com/wowsims/mop/sim/core/proto"
	"github.com/wowsims/mop/sim/mage"
)

const frostboltVariance = 0.24   // Per https://wago.tools/db2/SpellEffect?build=5.5.0.60802&filter%5BSpellID%5D=exact%253A116 Field: "Variance"
const frostboltScale = 1.5       // Per https://wago.tools/db2/SpellEffect?build=5.5.0.60802&filter%5BSpellID%5D=exact%253A116 Field: "Coefficient"
const frostboltCoefficient = 1.5 // Per https://wago.tools/db2/SpellEffect?build=5.5.0.60802&filter%5BSpellID%5D=exact%253A116 Field: "BonusCoefficient"

func (frostMage *FrostMage) frostBoltConfig(config core.SpellConfig) core.SpellConfig {
	return core.SpellConfig{
		ActionID:       config.ActionID,
		SpellSchool:    core.SpellSchoolFrost,
		ProcMask:       core.ProcMaskSpellDamage,
		Flags:          config.Flags,
		ClassSpellMask: mage.MageSpellFrostbolt,
		MissileSpeed:   28,

		ManaCost: config.ManaCost,
		Cast:     config.Cast,

		DamageMultiplier: config.DamageMultiplier,
		CritMultiplier:   frostMage.DefaultCritMultiplier(),
		BonusCoefficient: frostboltCoefficient,
		ThreatMultiplier: 1,

		ApplyEffects: config.ApplyEffects,
	}
}

func (frostMage *FrostMage) registerFrostboltSpell() {
	actionID := core.ActionID{SpellID: 116}
	hasGlyph := frostMage.HasMajorGlyph(proto.MageMajorGlyph_GlyphOfIcyVeins)
	var icyVeinsFrostBolt *core.Spell

	frostMage.RegisterSpell(frostMage.frostBoltConfig(core.SpellConfig{
		ActionID: actionID,
		Flags:    core.SpellFlagAPL,

		ManaCost: core.ManaCostOptions{
			BaseCostPercent: 4,
		},
		Cast: core.CastConfig{
			DefaultCast: core.Cast{
				GCD:      core.GCDDefault,
				CastTime: time.Second * 2,
			},
		},

		DamageMultiplier: 1,

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			hasSplitBolts := frostMage.IcyVeinsAura.IsActive() && hasGlyph
			damageMultiplier := core.TernaryFloat64(hasSplitBolts, 0.4, 1.0)

			spell.DamageMultiplier *= damageMultiplier
			baseDamage := frostMage.CalcAndRollDamageRange(sim, frostboltScale, frostboltVariance)
			result := spell.CalcDamage(sim, target, baseDamage, spell.OutcomeMagicHitAndCrit)
			spell.DamageMultiplier /= damageMultiplier

			if result.Landed() {
				frostMage.ProcFingersOfFrost(sim, spell)
			}

			if hasSplitBolts {
				icyVeinsFrostBolt.Cast(sim, target)
			}

			spell.WaitTravelTime(sim, func(sim *core.Simulation) {
				spell.DealDamage(sim, result)
				if result.Landed() {
					frostMage.GainIcicle(sim, target, result.Damage)
				}
			})
		},
	}))

	// Glyph of Icy Veins - Frostbolt
	icyVeinsFrostBolt = frostMage.RegisterSpell(frostMage.frostBoltConfig(core.SpellConfig{
		ActionID:       actionID.WithTag(1), // Real SpellID: 131079
		ClassSpellMask: mage.MageSpellFrostbolt,
		Flags:          core.SpellFlagPassiveSpell,

		DamageMultiplier: 0.4,

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			results := make([]*core.SpellResult, 2)

			for idx := range results {
				baseDamage := frostMage.CalcAndRollDamageRange(sim, frostboltScale, frostboltVariance)
				results[idx] = spell.CalcDamage(sim, target, baseDamage, spell.OutcomeMagicHitAndCrit)
				if results[idx].Landed() {
					frostMage.ProcFingersOfFrost(sim, spell)
				}
			}

			for _, result := range results {
				spell.WaitTravelTime(sim, func(sim *core.Simulation) {
					spell.DealDamage(sim, result)
					if result.Landed() {
						frostMage.GainIcicle(sim, target, result.Damage)
					}
				})
			}
		},
	}))
}
