package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.monsterEntity;
import com.tutien.pixel.services.MonsterService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/monster")
public class MonsterController {
    @Autowired
    MonsterService service;

    @GetMapping
    public List<monsterEntity> all() {
        return service.all();
    }
    @PutMapping("/{id}")
    public monsterEntity update(@PathVariable int id, monsterEntity entity) {
        return service.update(id, entity);
    }
    @GetMapping("/{id}")
    public monsterEntity get(@PathVariable int id) {
        return service.get(id);
    }

    @GetMapping("/code/{code}")
    public monsterEntity getByCode(@PathVariable String code) {
        return service.getByCode(code);
    }

    @PostMapping
    public monsterEntity save(@RequestBody monsterEntity m) {
        return service.save(m);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}
