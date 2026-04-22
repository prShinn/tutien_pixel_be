package com.tutien.pixel.services;

import com.tutien.pixel.entities.skillPlayerEntity;
import com.tutien.pixel.repositories.PlayerRepository;
import com.tutien.pixel.repositories.SkillPlayerRepository;
import com.tutien.pixel.repositories.SkillRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SkillPlayerService {
    @Autowired
    private SkillPlayerRepository repo;
    @Autowired
    private SkillRepository skillRepo;
    @Autowired
    private PlayerRepository playerRepo;


    public List<skillPlayerEntity> getByPlayer(int playerId) {
        return repo.findByPlayerId(playerId);
    }

    public skillPlayerEntity addSkill(int playerId, String skillCode) {

        if (repo.existsByPlayerIdAndSkillCode(playerId, skillCode)) {
            throw new RuntimeException("Skill already owned");
        }

        skillPlayerEntity sp = new skillPlayerEntity();
        sp.setPlayerId(playerId);
        sp.setLevel(1);
        sp.setSkillCode(skillCode);
        return repo.save(sp);
    }

    public void removeSkill(int playerId, String skillCode) {
        repo.deleteByPlayerIdAndSkillCode(playerId, skillCode);
    }

}
