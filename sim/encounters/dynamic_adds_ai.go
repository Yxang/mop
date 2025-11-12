package encounters

import (
	"time"

	"github.com/wowsims/mop/sim/core"
	"github.com/wowsims/mop/sim/core/proto"
	"github.com/wowsims/mop/sim/core/stats"
)

const (
	dynamicBossID int32 = 99999
	dynamicAddID  int32 = 99998
)

func addDynamicAddsAI() {
	createDynamicAddsAIPreset()
}

func createDynamicAddsAIPreset() {
	bossName := "Dynamic Boss"
	addName := "Dynamic Add"

	core.AddPresetTarget(&core.PresetTarget{
		PathPrefix: "Default",

		Config: &proto.Target{
			Id:        dynamicBossID,
			Name:      bossName,
			Level:     93,
			MobType:   proto.MobType_MobTypeMechanical,
			TankIndex: 0,

			Stats: stats.Stats{
				stats.Armor:       24835,
				stats.AttackPower: 0,
			}.ToProtoArray(),

			SpellSchool:   proto.SpellSchool_SpellSchoolPhysical,
			SwingSpeed:    2.0,
			MinBaseDamage: 900000,
			DamageSpread:  0.5,
			TargetInputs:  dynamicAddsTargetInputs(),
		},

		AI: makeDynamicAddsAI(true),
	})

	core.AddPresetTarget(&core.PresetTarget{
		PathPrefix: "Default",

		Config: &proto.Target{
			Id:        dynamicAddID,
			Name:      addName,
			Level:     93,
			MobType:   proto.MobType_MobTypeMechanical,
			TankIndex: 1,

			Stats: stats.Stats{
				stats.Armor:       24835,
				stats.AttackPower: 0,
			}.ToProtoArray(),

			SpellSchool:   proto.SpellSchool_SpellSchoolPhysical,
			SwingSpeed:    1.5,
			MinBaseDamage: 300000,
			DamageSpread:  0.4,
			TargetInputs:  []*proto.TargetInput{},
		},

		AI: makeDynamicAddsAI(false),
	})

	core.AddPresetEncounter("Dynamic", []string{
		"Default/" + bossName,
		"Default/" + addName,
	})
}

func dynamicAddsTargetInputs() []*proto.TargetInput {
	return []*proto.TargetInput{
		{
			Label:       "Add spawn interval",
			Tooltip:     "Time between add spawns (in seconds)",
			InputType:   proto.InputType_Number,
			NumberValue: 30,
		},
		{
			Label:       "Add lifetime",
			Tooltip:     "How long adds stay alive (in seconds)",
			InputType:   proto.InputType_Number,
			NumberValue: 20,
		},
		{
			Label:       "Add spawn delay",
			Tooltip:     "Initial delay before first add spawns (in seconds)",
			InputType:   proto.InputType_Number,
			NumberValue: 10,
		},
	}
}

func makeDynamicAddsAI(isBoss bool) core.AIFactory {
	return func() core.TargetAI {
		return &DynamicAddsAI{
			isBoss: isBoss,
		}
	}
}

type DynamicAddsAI struct {
	Target     *core.Target
	BossUnit   *core.Unit
	AddUnits   []*core.Unit
	MainTank   *core.Unit
	OffTank    *core.Unit
	ValidTanks []*core.Unit

	// Static parameters associated with a given preset
	isBoss bool

	spawnInterval time.Duration
	addLifetime   time.Duration
	spawnDelay    time.Duration

	activeAdds    map[*core.Unit]bool
	nextSpawnTime time.Duration
}

func (ai *DynamicAddsAI) Initialize(target *core.Target, config *proto.Target) {
	ai.Target = target
	ai.Target.AutoAttacks.MHConfig().ActionID.Tag = core.TernaryInt32(ai.isBoss, dynamicBossID, dynamicAddID)

	if ai.isBoss {
		ai.BossUnit = &target.Unit
		for _, encounterTarget := range target.Env.Encounter.AllTargetUnits {
			if encounterTarget != &target.Unit {
				ai.AddUnits = append(ai.AddUnits, encounterTarget)
			}
		}
	} else {
		for _, encounterTarget := range target.Env.Encounter.AllTargets {
			if encounterTarget.AI != nil {
				if bossAI, ok := encounterTarget.AI.(*DynamicAddsAI); ok && bossAI.isBoss {
					ai.BossUnit = &encounterTarget.Unit
					break
				}
			}
		}
	}

	if ai.BossUnit != nil {
		ai.MainTank = ai.BossUnit.CurrentTarget
	}
	if len(ai.AddUnits) > 0 {
		ai.OffTank = ai.AddUnits[0].CurrentTarget
	}

	ai.ValidTanks = core.FilterSlice([]*core.Unit{ai.MainTank, ai.OffTank}, func(unit *core.Unit) bool {
		return unit != nil
	})

	if ai.isBoss && len(config.TargetInputs) >= 3 {
		ai.spawnInterval = core.DurationFromSeconds(config.TargetInputs[0].NumberValue)
		ai.addLifetime = core.DurationFromSeconds(config.TargetInputs[1].NumberValue)
		ai.spawnDelay = core.DurationFromSeconds(config.TargetInputs[2].NumberValue)
	}

	ai.activeAdds = make(map[*core.Unit]bool)
}

func (ai *DynamicAddsAI) Reset(sim *core.Simulation) {
	ai.Target.ExtendGCDUntil(sim, core.DurationFromSeconds(sim.RandomFloat("Specials Timing")*core.BossGCD.Seconds()))
	ai.Target.AutoAttacks.RandomizeMeleeTiming(sim)

	if !ai.isBoss {
		return
	}

	ai.activeAdds = make(map[*core.Unit]bool)
	ai.nextSpawnTime = ai.spawnDelay

	for _, addTarget := range ai.AddUnits {
		sim.DisableTargetUnit(addTarget, true)
	}

	if ai.spawnDelay > 0 {
		pa := sim.GetConsumedPendingActionFromPool()
		pa.NextActionAt = ai.spawnDelay
		pa.Priority = core.ActionPriorityDOT
		pa.OnAction = func(sim *core.Simulation) {
			ai.spawnAdd(sim)
		}
		sim.AddPendingAction(pa)
	} else {
		ai.spawnAdd(sim)
	}
}

func (ai *DynamicAddsAI) spawnAdd(sim *core.Simulation) {
	var addUnit *core.Unit
	for _, target := range ai.AddUnits {
		if !ai.activeAdds[target] {
			addUnit = target
			break
		}
	}

	if addUnit == nil {
		if ai.spawnInterval > 0 {
			ai.nextSpawnTime += ai.spawnInterval

			pa := sim.GetConsumedPendingActionFromPool()
			pa.NextActionAt = ai.nextSpawnTime
			pa.Priority = core.ActionPriorityDOT
			pa.OnAction = func(sim *core.Simulation) {
				ai.spawnAdd(sim)
			}
			sim.AddPendingAction(pa)
		}
		return
	}

	sim.EnableTargetUnit(addUnit)
	ai.activeAdds[addUnit] = true

	if sim.Log != nil {
		sim.Log("Spawned add (%s) at %s. Current Active adds: %d",
			addUnit.Label, sim.CurrentTime, len(ai.activeAdds))
	}

	pa := sim.GetConsumedPendingActionFromPool()
	pa.NextActionAt = sim.CurrentTime + ai.addLifetime
	pa.Priority = core.ActionPriorityDOT
	pa.OnAction = func(sim *core.Simulation) {
		ai.despawnAdd(sim, addUnit)
	}
	sim.AddPendingAction(pa)

	ai.nextSpawnTime += ai.spawnInterval

	pa = sim.GetConsumedPendingActionFromPool()
	pa.NextActionAt = ai.nextSpawnTime
	pa.Priority = core.ActionPriorityDOT
	pa.OnAction = func(sim *core.Simulation) {
		ai.spawnAdd(sim)
	}
	sim.AddPendingAction(pa)
}

func (ai *DynamicAddsAI) despawnAdd(sim *core.Simulation, addUnit *core.Unit) {
	sim.DisableTargetUnit(addUnit, true)
	delete(ai.activeAdds, addUnit)

	if sim.Log != nil {
		sim.Log("Despawned add %s at %s. Currently Active Adds: %d",
			addUnit.Label, sim.CurrentTime, len(ai.activeAdds))
	}
}

func (ai *DynamicAddsAI) ExecuteCustomRotation(sim *core.Simulation) {
	target := ai.Target.CurrentTarget
	if target == nil {
		target = &ai.Target.Env.Raid.Parties[0].Players[0].GetCharacter().Unit
	}

	ai.Target.ExtendGCDUntil(sim, sim.CurrentTime+core.BossGCD)
}
