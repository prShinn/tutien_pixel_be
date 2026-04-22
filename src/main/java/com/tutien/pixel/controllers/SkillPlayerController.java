package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.skillPlayerEntity;
import com.tutien.pixel.services.SkillPlayerService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/player-skills")
public class SkillPlayerController {

    private final SkillPlayerService service;

    public SkillPlayerController(SkillPlayerService service) {
        this.service = service;
    }

    @GetMapping("/{playerId}")
    public List<skillPlayerEntity> getSkills(@PathVariable int playerId) {
        return service.getByPlayer(playerId);
    }

    @PostMapping
    public skillPlayerEntity addSkill(@RequestParam int playerId,
                                      @RequestParam String skillCode) {
        return service.addSkill(playerId, skillCode);
    }

    @DeleteMapping
    public void removeSkill(@RequestParam int playerId,
                            @RequestParam String skillCode) {
        service.removeSkill(playerId, skillCode);
    }
}