package com.tutien.pixel.controllers;


import com.tutien.pixel.entities.skillEntity;
import com.tutien.pixel.services.SkillService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/skills")
public class SkillController {

    private final SkillService service;

    public SkillController(SkillService service) {
        this.service = service;
    }

    @GetMapping
    public List<skillEntity> getAll() {
        return service.getAll();
    }

    @GetMapping("/{id}")
    public skillEntity getById(@PathVariable int id) {
        return service.getById(id);
    }

    @PostMapping
    public skillEntity create(@RequestBody skillEntity skill) {
        return service.create(skill);
    }

    @PutMapping("/{id}")
    public skillEntity update(@PathVariable int id,
                              @RequestBody skillEntity skill) {
        return service.update(id, skill);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}