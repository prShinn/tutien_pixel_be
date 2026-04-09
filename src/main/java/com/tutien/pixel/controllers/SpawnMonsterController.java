package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.spawnMonsterEntity;
import com.tutien.pixel.services.SpawnMonsterService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/spawn")
public class SpawnMonsterController {

    @Autowired
    SpawnMonsterService service;

    @GetMapping
    public List<spawnMonsterEntity> all() {
        return service.all();
    }

    @GetMapping("/{id}")
    public spawnMonsterEntity get(@PathVariable int id) {
        return service.get(id);
    }

    @GetMapping("/map/{mapCode}")
    public List<spawnMonsterEntity> getByMap(@PathVariable String mapCode) {
        return service.getByMap(mapCode);
    }

    @PostMapping
    public spawnMonsterEntity save(@RequestBody spawnMonsterEntity e) {
        return service.save(e);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}
